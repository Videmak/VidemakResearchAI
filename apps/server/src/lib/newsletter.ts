import { sql } from '../db.js';
import { settings, type EffectiveSettings } from './settings.js';

/**
 * Newsletter on MailCheap (mailcheap.ai): Videmak keeps the list in step with its accounts.
 * People with a confirmed email are added (tag "videmak"); anyone can leave from the
 * account page or any newsletter's unsubscribe link, and Videmak mirrors those leavers back.
 * Videmak's own account emails go through Admin › Email, not MailCheap.
 */

export const MAILCHEAP_URL = 'https://mailcheap.ai/api/v1';
const RETRY = new Set(['rate_limited', 'unavailable', 'internal_error']);

export class MailCheapError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(`MailCheap ${status} ${code}: ${message}`);
  }
}

type Contact = { email?: string; status?: string };
export type ImportRow = { email: string; status: 'active' | 'unsubscribed'; firstName?: string; tags: string[] };

export class MailCheap {
  constructor(
    private readonly apiKey: string,
    private readonly newsletter: string | null,
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = MAILCHEAP_URL,
    private readonly pauseMs = 1000,
  ) {}

  private async call<T>(method: string, path: string, options: { body?: Record<string, unknown>; query?: Record<string, string | number | undefined | null> } = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [name, value] of Object.entries(options.query ?? {})) if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
    let wait = this.pauseMs;
    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method,
          headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        if (attempt >= 3) throw new MailCheapError(0, 'unavailable', (error as Error).message);
        await new Promise((resolve) => setTimeout(resolve, wait)); wait *= 2;
        continue;
      }
      const text = await response.text();
      const json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : {};
      if (response.ok) return (json ?? {}) as T;
      const error = (json && typeof json === 'object' && (json as any).error) || {};
      const code = String(error.code || (response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'unavailable' : 'error'));
      if (RETRY.has(code) && attempt < 3) {
        const after = Number(response.headers.get('retry-after'));
        await new Promise((resolve) => setTimeout(resolve, Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 10_000) : wait)); wait *= 2;
        continue;
      }
      throw new MailCheapError(response.status, code, String(error.message || text.slice(0, 200) || response.statusText));
    }
  }

  private withNewsletter<T extends Record<string, unknown>>(body: T) {
    return this.newsletter ? { ...body, newsletter: this.newsletter } : body;
  }

  billing() {
    return this.call<{ billing?: { plan?: { name?: string } | string }; usage?: { subscribers?: number; subscribersLimit?: number } }>('GET', '/billing');
  }

  async newsletters() {
    const data = await this.call<{ newsletters?: { name?: string; slug?: string }[] } | { name?: string; slug?: string }[]>('GET', '/newsletters');
    return Array.isArray(data) ? data : data.newsletters ?? [];
  }

  /** Adds or updates up to 1,000 contacts (they agreed through their Videmak account). */
  importContacts(contacts: ImportRow[]) {
    return this.call<{ importId?: string }>('POST', '/contacts/import', { body: this.withNewsletter({ consent: true, contacts }) });
  }

  setStatus(email: string, status: 'active' | 'unsubscribed') {
    return this.call('PATCH', `/contacts/${encodeURIComponent(email).replace(/%40/g, '@')}`, { body: this.withNewsletter(status === 'active' ? { status, consent: true } : { status }) });
  }

  async *contacts(status: string): AsyncGenerator<Contact> {
    let cursor: string | undefined;
    for (let page = 0; page < 1000; page += 1) {
      const data = await this.call<{ contacts?: Contact[]; nextCursor?: string }>('GET', '/contacts', { query: { newsletter: this.newsletter, status, limit: 100, cursor } });
      for (const contact of data.contacts ?? []) yield contact;
      if (!data.nextCursor) return;
      cursor = data.nextCursor;
    }
  }
}

export const newsletterOn = (s: EffectiveSettings = settings()) => s.newsletterProvider === 'mailcheap' && Boolean(s.mailcheapApiKey);
export const mailcheap = (s: EffectiveSettings = settings()) => new MailCheap(s.mailcheapApiKey, s.mailcheapNewsletter || null);

/** Plan and contact count, for the admin's Test connection. */
export async function describeMailCheap(client = mailcheap()) {
  const [billing, lists] = await Promise.all([client.billing(), client.newsletters().catch(() => [])]);
  const plan = billing.billing?.plan;
  const usage = billing.usage ?? {};
  return {
    plan: typeof plan === 'string' ? plan : plan?.name ?? null,
    contacts: typeof usage.subscribers === 'number' ? usage.subscribers : null,
    limit: typeof usage.subscribersLimit === 'number' ? usage.subscribersLimit : null,
    newsletters: lists.map((list) => list.slug || list.name).filter(Boolean) as string[],
  };
}

export type SyncResult = { ran_at: string; imported: number; updated: number; mirrored: number; failed: number; error: string | null };
let lastSync: SyncResult | null = null;
let running: Promise<SyncResult> | null = null;
export const lastNewsletterSync = () => lastSync;

const LEAVER_STATUSES = ['unsubscribed', 'bounced', 'complained'] as const;

/**
 * One pass: (1) people who left through a MailCheap link are marked unsubscribed here,
 * (2) choices changed on the account page are sent, (3) new confirmed accounts are added.
 */
export function syncNewsletter(client = mailcheap()): Promise<SyncResult> {
  if (running) return running;
  running = (async () => {
    const result: SyncResult = { ran_at: new Date().toISOString(), imported: 0, updated: 0, mirrored: 0, failed: 0, error: null };
    try {
      for (const status of LEAVER_STATUSES) {
        const emails: string[] = [];
        for await (const contact of client.contacts(status)) if (contact.email) emails.push(contact.email.toLowerCase());
        for (let start = 0; start < emails.length; start += 1000) {
          const rows = await sql`
            update users set newsletter_opt_out = true, newsletter_synced = ${status}, newsletter_synced_at = now(), newsletter_error = null
            where lower(email) = any(${emails.slice(start, start + 1000)}) and not newsletter_dirty and newsletter_synced is distinct from ${status}
            returning id`;
          result.mirrored += rows.length;
        }
      }

      await sql`update users set newsletter_dirty = false where newsletter_dirty and newsletter_synced is null`;
      const changed = await sql<{ id: string; email: string; newsletter_opt_out: boolean }[]>`
        select id, email, newsletter_opt_out from users where newsletter_dirty and newsletter_synced is not null order by id limit 500`;
      for (const row of changed) {
        const status = row.newsletter_opt_out ? 'unsubscribed' : 'active';
        try {
          await client.setStatus(row.email, status);
          await sql`update users set newsletter_synced = ${status}, newsletter_synced_at = now(), newsletter_dirty = false, newsletter_error = null where id = ${row.id}`;
          result.updated += 1;
        } catch (error) {
          // Deleted in MailCheap: added again below if they still want the newsletter.
          if (error instanceof MailCheapError && error.code === 'not_found') {
            await sql`update users set newsletter_synced = null, newsletter_dirty = false, newsletter_error = null where id = ${row.id}`;
          } else {
            await sql`update users set newsletter_error = ${(error as Error).message.slice(0, 300)} where id = ${row.id}`;
            result.failed += 1;
          }
        }
      }

      for (let batch = 0; batch < 20; batch += 1) {
        const fresh = await sql<{ id: string; email: string; full_name: string | null }[]>`
          select id, email, full_name from users
          where newsletter_synced is null and not newsletter_opt_out and email_verified_at is not null and disabled_at is null
            and (newsletter_error is null or newsletter_synced_at is null or newsletter_synced_at < now() - interval '1 hour')
          order by created_at limit 1000`;
        if (!fresh.length) break;
        const ids = fresh.map((row) => row.id);
        try {
          await client.importContacts(fresh.map((row) => ({
            email: row.email, status: 'active', tags: ['videmak'], ...(row.full_name ? { firstName: row.full_name.split(/\s+/)[0] } : {}),
          })));
          await sql`update users set newsletter_synced = 'active', newsletter_synced_at = now(), newsletter_error = null, newsletter_dirty = false where id = any(${ids})`;
          result.imported += ids.length;
        } catch (error) {
          // Retried after an hour (for example once the MailCheap plan has room again).
          await sql`update users set newsletter_error = ${(error as Error).message.slice(0, 300)}, newsletter_synced_at = now() where id = any(${ids})`;
          result.failed += ids.length;
          result.error = (error as Error).message.slice(0, 300);
          break;
        }
        if (fresh.length < 1000) break;
      }
    } catch (error) {
      result.error = (error as Error).message.slice(0, 300);
    }
    lastSync = result;
    return result;
  })().finally(() => { running = null; });
  return running;
}

/** Counts for Admin › Newsletter. */
export async function newsletterCounts() {
  const [row] = await sql<{ subscribed: number; left: number; waiting: number; unconfirmed: number; errors: number }[]>`
    select
      count(*) filter (where newsletter_synced = 'active' and not newsletter_opt_out)::int as subscribed,
      count(*) filter (where newsletter_opt_out)::int as left,
      count(*) filter (where newsletter_synced is null and not newsletter_opt_out and email_verified_at is not null)::int as waiting,
      count(*) filter (where email_verified_at is null and not newsletter_opt_out)::int as unconfirmed,
      count(*) filter (where newsletter_error is not null)::int as errors
    from users where disabled_at is null`;
  return row;
}

let timer: NodeJS.Timeout | null = null;
/** Runs a sync soon (after a sign-up, a confirmed email or a changed choice); several calls make one run. */
export function queueNewsletterSync(delayMs = 20_000) {
  if (!newsletterOn() || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void syncNewsletter().catch(() => undefined);
  }, delayMs);
  timer.unref?.();
}

/** Every 15 minutes while MailCheap is set up. */
export function startNewsletterSync() {
  setInterval(() => { if (newsletterOn()) void syncNewsletter().catch(() => undefined); }, 15 * 60_000).unref();
}

/** The person's own choice from the account page; sent to MailCheap at once when possible. */
export async function setNewsletterChoice(userId: string, subscribed: boolean) {
  const [row] = await sql<{ email: string; newsletter_synced: string | null }[]>`
    update users set newsletter_opt_out = ${!subscribed}, newsletter_dirty = true, newsletter_error = null where id = ${userId}
    returning email, newsletter_synced`;
  if (!row || !newsletterOn()) return;
  if (row.newsletter_synced) {
    try {
      const status = subscribed ? 'active' : 'unsubscribed';
      await mailcheap().setStatus(row.email, status);
      await sql`update users set newsletter_synced = ${status}, newsletter_synced_at = now(), newsletter_dirty = false where id = ${userId}`;
      return;
    } catch (error) {
      console.error(`newsletter: choice for user ${userId} not sent yet: ${(error as Error).message}`);
    }
  }
  queueNewsletterSync(5_000);
}
