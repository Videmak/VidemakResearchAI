import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireAdmin, type AppVariables } from '../auth.js';
import { describeSettings, saveSettings, settings, SETTING_FIELDS, type SettingKey } from '../lib/settings.js';
import { WEBHOOK_EVENTS } from './stripeWebhook.js';
import { passwordSwitchProblem, PROVIDERS, redirectUri } from '../lib/signin.js';
import { env } from '../env.js';
import { stripeClient } from '../lib/stripeBilling.js';
import { loadPlans } from '../lib/plans.js';
import { checkScholar } from '../lib/scholar.js';
import { mendeleyRedirectUri, zoteroCallbackUrl } from '../lib/referenceManagers.js';
import { syncPlanToStripe } from '../lib/planBilling.js';
import type { Slots } from '../slots/types.js';
import { BucketStore, bucketConfig, copyStatus, startCopyToBucket, testStorage } from '../lib/storage.js';
import { mailProvider, sendMail } from '../lib/mail.js';
import { testEmail } from '../lib/emails.js';
import { describeMailCheap, lastNewsletterSync, newsletterCounts, newsletterOn, syncNewsletter } from '../lib/newsletter.js';

const STORAGE_KEYS = new Set(['storageProvider', 's3Region', 's3Bucket', 's3AccessKeyId', 's3SecretAccessKey', 's3Endpoint', 's3UrlStyle', 's3Prefix']);
const STORE_NAMES = { local: 'This server', wasabi: 'Wasabi', s3: 'S3-compatible' } as const;

const keys = SETTING_FIELDS.map((field) => field.key) as [SettingKey, ...SettingKey[]];

/** Admin page API: provider keys and options, connection tests, Stripe set-up, an overview. */
export function adminRoutes(slots: Slots) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', requireAdmin);

  app.get('/settings', (c) => c.json({
    settings: describeSettings(),
    // What to paste into Stripe → Developers → Webhooks → Add endpoint.
    stripe_webhook: { url: `${settings().publicUrl.replace(/\/$/, '')}/api/stripe/webhook`, events: WEBHOOK_EVENTS },
    // What to paste as the redirect / return URL in Google, Microsoft and Apple.
    signin_redirects: Object.fromEntries(PROVIDERS.map((provider) => [provider, redirectUri(provider)])),
    library_redirects: { zotero: zoteroCallbackUrl(), mendeley: mendeleyRedirectUri() },
  }));

  app.put('/settings', async (c) => {
    const parsed = z.object({ values: z.record(z.enum(keys), z.string().max(4000).nullable()) }).safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: 'Unknown setting.' });
    const stripeKey = parsed.data.values.stripeSecretKey;
    if (stripeKey && !/^(sk|rk)_test_/.test(stripeKey.trim())) {
      throw new HTTPException(422, { message: 'Use a Stripe TEST key (sk_test_…) for now. Live billing opens after the switch-over.' });
    }
    // Email and password stays on until a provider can sign people up instead.
    const next = { ...settings() } as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed.data.values)) next[key] = value?.trim() || String((env as Record<string, unknown>)[key] ?? '');
    const problem = passwordSwitchProblem(next as unknown as ReturnType<typeof settings>);
    if (problem) throw new HTTPException(422, { message: problem });
    // A bucket is checked before it is saved, so uploads never start failing after a typo.
    const nextSettings = next as unknown as ReturnType<typeof settings>;
    if (Object.keys(parsed.data.values).some((key) => STORAGE_KEYS.has(key)) && ['wasabi', 's3'].includes(nextSettings.storageProvider)) {
      try { await testStorage(new BucketStore(bucketConfig(nextSettings))); } catch (error) {
        throw new HTTPException(422, { message: `Not saved. The bucket check failed: ${(error as Error).message}`.slice(0, 400) });
      }
    }
    await saveSettings(parsed.data.values, c.get('user')!.id);
    return c.json({ settings: describeSettings() });
  });

  app.post('/test/ai', async (c) => {
    const started = Date.now();
    try {
      const result = await slots.llm.complete({ messages: [{ role: 'user', content: 'Reply with the single word: ready' }], maxTokens: 5, temperature: 0 });
      return c.json({ ok: true, provider: slots.llm.provider, reply: result.text.trim().slice(0, 40), ms: Date.now() - started });
    } catch (error) {
      return c.json({ ok: false, provider: slots.llm.provider, error: (error as Error).message.slice(0, 300) });
    }
  });

  app.post('/test/papers', async (c) => {
    const started = Date.now();
    try {
      const papers = await slots.papers.search({ query: 'sleep memory consolidation', limit: 1 });
      const scholar = slots.papers.provider === 'openalex' ? null : await checkScholar();
      return c.json({
        ok: papers.length > 0, provider: slots.papers.provider, sample: papers[0]?.title ?? null, ms: Date.now() - started,
        ...(scholar ? { full_text: scholar.files ? 'on' : 'off', research_tools: scholar.research ? 'on' : 'off', ...(scholar.requests_left_today ? { requests_left_today: scholar.requests_left_today } : {}) } : {}),
      });
    } catch (error) {
      return c.json({ ok: false, provider: slots.papers.provider, error: (error as Error).message.slice(0, 300) });
    }
  });

  app.post('/test/stripe', async (c) => {
    try {
      const stripe = stripeClient();
      if (!stripe) return c.json({ ok: false, error: 'No Stripe key saved yet.' });
      const balance = await stripe.balance.retrieve();
      return c.json({ ok: true, mode: balance.livemode ? 'live' : 'test' });
    } catch (error) {
      return c.json({ ok: false, error: (error as Error).message.slice(0, 300) });
    }
  });

  app.post('/test/storage', async (c) => {
    try {
      const result = await testStorage();
      return c.json({ ok: true, provider: STORE_NAMES[result.provider], ms: result.ms });
    } catch (error) {
      return c.json({ ok: false, error: (error as Error).message.slice(0, 300) });
    }
  });

  /** Sends a test email to the admin who asks. */
  app.post('/test/email', async (c) => {
    const provider = mailProvider();
    if (!provider) return c.json({ ok: false, error: 'Choose SMTP or Resend, fill in its settings and a From address, then save.' });
    const to = c.get('user')!.email;
    try {
      await sendMail(testEmail(to, provider === 'smtp' ? 'SMTP' : 'Resend'));
      return c.json({ ok: true, provider: provider === 'smtp' ? 'SMTP' : 'Resend', mode: `sent to ${to}` });
    } catch (error) {
      return c.json({ ok: false, error: (error as Error).message.slice(0, 300) });
    }
  });

  app.post('/test/newsletter', async (c) => {
    if (!newsletterOn()) return c.json({ ok: false, error: 'Choose MailCheap and save its API key first.' });
    try {
      const info = await describeMailCheap();
      const usage = info.contacts !== null ? `${info.contacts.toLocaleString('en-US')}${info.limit ? ` of ${info.limit.toLocaleString('en-US')}` : ''} contacts` : '';
      return c.json({ ok: true, provider: 'MailCheap', mode: [info.plan, usage].filter(Boolean).join(' · ') });
    } catch (error) {
      return c.json({ ok: false, error: (error as Error).message.slice(0, 300) });
    }
  });

  /** Storage in use and the progress of copying this server's files into the bucket. */
  app.get('/storage', (c) => c.json({ provider: settings().storageProvider || 'local', copy: copyStatus() }));
  app.post('/storage/copy', (c) => {
    try { return c.json({ copy: startCopyToBucket() }); } catch (error) {
      throw new HTTPException(422, { message: (error as Error).message });
    }
  });

  app.get('/newsletter', async (c) => c.json({ on: newsletterOn(), counts: await newsletterCounts(), last_sync: lastNewsletterSync() }));
  app.post('/newsletter/sync', async (c) => {
    if (!newsletterOn()) throw new HTTPException(422, { message: 'Choose MailCheap and save its API key first.' });
    const result = await syncNewsletter();
    return c.json({ result, counts: await newsletterCounts() });
  });

  /**
   * One click: points a Stripe webhook at this server with the events it needs (saving the new
   * signing secret), and creates the Stripe prices of every plan sold online.
   */
  app.post('/stripe/setup', async (c) => {
    const stripe = stripeClient();
    if (!stripe) throw new HTTPException(422, { message: 'Save a Stripe secret key first.' });
    const url = `${settings().publicUrl.replace(/\/$/, '')}/api/stripe/webhook`;
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const existing = endpoints.data.find((endpoint) => endpoint.url === url);
    let created = false;
    if (existing) {
      await stripe.webhookEndpoints.update(existing.id, { enabled_events: [...WEBHOOK_EVENTS], disabled: false });
    } else {
      const endpoint = await stripe.webhookEndpoints.create({ url, enabled_events: [...WEBHOOK_EVENTS], description: 'Videmak' });
      if (endpoint.secret) await saveSettings({ stripeWebhookSecret: endpoint.secret }, c.get('user')!.id);
      created = true;
    }
    const { plans } = await loadPlans();
    let synced = 0;
    for (const plan of plans.filter((item) => item.checkout === 'self_serve' && !item.is_default)) {
      await syncPlanToStripe(stripe, plan.id);
      synced += 1;
    }
    return c.json({ ok: true, webhook: created ? 'created' : 'updated', plans: synced });
  });

  app.get('/overview', async (c) => {
    const [counts] = await sql<{ users: number; documents: number; library: number; keys: number }[]>`
      select (select count(*)::int from users) as users, (select count(*)::int from documents) as documents,
             (select count(*)::int from library_documents) as library, (select count(*)::int from api_keys where revoked_at is null) as keys`;
    const usage = await sql`
      select service, sum(quantity)::float as quantity from usage_events
      where created_at >= date_trunc('month', now() at time zone 'utc') group by service order by service`;
    const audit = await sql`
      select a.action, a.target, a.created_at, u.email from admin_audit a left join users u on u.id = a.user_id
      order by a.created_at desc limit 20`;
    return c.json({ counts, usage, audit });
  });

  return app;
}
