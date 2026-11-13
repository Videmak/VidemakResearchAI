import { createHash } from 'node:crypto';
import { sql } from '../db.js';
import { openSecret, sealSecret, settings, type EffectiveSettings } from './settings.js';

/**
 * Sign in with CitedEvidence. CitedEvidence is an OAuth 2.1 server (PKCE, rotating refresh
 * tokens) whose /oauth/userinfo names the account and its plan's tier: lite (Free, Basic),
 * pro (Premium) or max (Advanced, Max, admins). With "Accounts and plans on CitedEvidence" on,
 * it is the only way in and that plan decides who may use Videmak; the plan is read again at
 * most once an hour with the stored refresh token.
 */

const RANK: Record<string, number> = { lite: 0, pro: 1, max: 2 };
/** A plan read this long ago still counts while CitedEvidence can't be reached. */
const STALE_AFTER_MS = 3 * 24 * 3600 * 1000;
const RECHECK_AFTER_MS = 3600 * 1000;
const USER_AGENT = 'Videmak/1.0 (+https://videmak.net)';

const isOn = (value: string | undefined) => (value ?? '').trim().toLowerCase() === 'on';

export const ceBase = (s: EffectiveSettings = settings()) => (s.citedevidenceUrl || 'https://citedevidence.com').replace(/\/+$/, '');
export const ceConfigured = (s: EffectiveSettings = settings()) => Boolean(s.citedevidenceClientId && s.citedevidenceClientSecret);
/** Accounts and plans live on CitedEvidence: it is the only way in, and its plan is needed. */
export const ceAccounts = (s: EffectiveSettings = settings()) => ceConfigured(s) && isOn(s.citedevidenceAccounts);
/** The CitedEvidence button shows (switched on, or required by accounts mode) once it is set up. */
export const ceUsable = (s: EffectiveSettings = settings()) => ceConfigured(s) && (isOn(s.signinCitedevidence) || isOn(s.citedevidenceAccounts));
export const ceMinTier = (s: EffectiveSettings = settings()) => (s.citedevidenceMinTier in RANK ? s.citedevidenceMinTier : 'pro');

export const ceRedirectUri = (s: EffectiveSettings = settings()) =>
  s.citedevidenceRedirectUri || `${s.publicUrl.replace(/\/+$/, '')}/api/auth/oauth/citedevidence/callback`;

/** Links for the browser: plans, the account's subscription page, and sign-up. */
export function ceLinks(s: EffectiveSettings = settings()) {
  const tagged = (path: string) => `${ceBase(s)}${path}${path.includes('?') ? '&' : '?'}utm_source=videmak&utm_medium=referral&utm_campaign=app`;
  const tier = ceMinTier(s);
  return {
    name: 'CitedEvidence',
    url: ceBase(s),
    pricing_url: tagged('/pricing'),
    manage_url: tagged('/profile'),
    // "Videmak is included with …"
    included_with: tier === 'max' ? 'CitedEvidence Advanced and up' : tier === 'lite' ? 'every paid CitedEvidence plan' : 'CitedEvidence Premium and up',
  };
}

/** The CitedEvidence sign-in page for one round trip (state is our flow id, PKCE S256). */
export function ceAuthorizeUrl(state: string, verifier: string, s: EffectiveSettings = settings()) {
  const url = new URL(`${ceBase(s)}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', s.citedevidenceClientId);
  url.searchParams.set('redirect_uri', ceRedirectUri(s));
  url.searchParams.set('scope', 'profile offline_access');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export type CePlan = { name: string | null; active: boolean; tier: string | null; admin: boolean };
export type CeAccount = { subject: string; email: string | null; emailVerified: boolean; name: string | null; plan: CePlan };

class CeError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

async function tokenRequest(form: Record<string, string>, s: EffectiveSettings) {
  const credentials = Buffer.from(`${encodeURIComponent(s.citedevidenceClientId)}:${encodeURIComponent(s.citedevidenceClientSecret)}`).toString('base64');
  const response = await fetch(`${ceBase(s)}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': USER_AGENT },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null) as { access_token?: string; refresh_token?: string; error?: string } | null;
  if (!response.ok || !body?.access_token) throw new CeError(`CitedEvidence token request failed (${response.status} ${body?.error ?? ''})`.trim(), body?.error ?? 'failed');
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? null };
}

async function readAccount(accessToken: string, s: EffectiveSettings): Promise<CeAccount> {
  const response = await fetch(`${ceBase(s)}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null) as Record<string, any> | null;
  if (!response.ok || !body?.sub) throw new CeError(`CitedEvidence userinfo failed (${response.status})`, body?.error ?? 'failed');
  const plan = (body.plan ?? {}) as Record<string, unknown>;
  return {
    subject: String(body.sub),
    email: typeof body.email === 'string' ? body.email.trim().toLowerCase() : null,
    emailVerified: body.email_verified === true,
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null,
    plan: {
      name: typeof plan.name === 'string' ? plan.name : null,
      active: plan.active === true,
      tier: typeof plan.tier === 'string' && plan.tier in RANK ? plan.tier : null,
      admin: plan.admin === true,
    },
  };
}

/** Finishes the round trip: trades the code, reads the account. */
export async function ceFinish(code: string, verifier: string) {
  const s = settings();
  try {
    const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: ceRedirectUri(s), code_verifier: verifier }, s);
    return { account: await readAccount(tokens.accessToken, s), refreshToken: tokens.refreshToken };
  } catch (error) {
    console.warn('CitedEvidence sign-in failed:', (error as Error).message);
    throw new Error('CitedEvidence sign-in did not finish. Try again.');
  }
}

/** Saves who the person is on CitedEvidence and their plan as just read. */
export async function saveCeLink(userId: string, account: CeAccount, refreshToken: string | null) {
  await sql`
    insert into citedevidence_links (user_id, subject, email, plan_name, plan_tier, plan_active, plan_admin, refresh_token_encrypted, plan_checked_at, attempted_at, check_error)
    values (${userId}, ${account.subject}, ${account.email}, ${account.plan.name}, ${account.plan.tier}, ${account.plan.active}, ${account.plan.admin},
            ${refreshToken ? sealSecret(refreshToken) : null}, now(), now(), null)
    on conflict (user_id) do update set subject = excluded.subject, email = excluded.email, plan_name = excluded.plan_name,
      plan_tier = excluded.plan_tier, plan_active = excluded.plan_active, plan_admin = excluded.plan_admin,
      refresh_token_encrypted = coalesce(excluded.refresh_token_encrypted, citedevidence_links.refresh_token_encrypted),
      plan_checked_at = now(), attempted_at = now(), check_error = null`;
  forgetAccess();
}

/**
 * Reads the person's plan again with their refresh token, at most once an hour unless `force`.
 * Claiming the attempt first keeps two processes from refreshing at once. A refused token
 * (disconnected on CitedEvidence, or 90 days unused) ends the plan until they sign in again.
 */
export async function refreshCeLink(userId: string, options: { force?: boolean } = {}) {
  const s = settings();
  if (!ceConfigured(s)) return;
  const since = new Date(Date.now() - (options.force ? 15_000 : RECHECK_AFTER_MS));
  const [claimed] = await sql<{ refresh_token_encrypted: string | null }[]>`
    update citedevidence_links set attempted_at = now()
    where user_id = ${userId} and (attempted_at is null or attempted_at < ${since})
    returning refresh_token_encrypted`;
  if (!claimed) return;
  if (!claimed.refresh_token_encrypted) {
    await sql`update citedevidence_links set plan_active = false, check_error = 'signed_out' where user_id = ${userId}`;
    forgetAccess();
    return;
  }
  try {
    const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: openSecret(claimed.refresh_token_encrypted) }, s);
    const account = await readAccount(tokens.accessToken, s);
    await saveCeLink(userId, account, tokens.refreshToken);
  } catch (error) {
    const code = error instanceof CeError ? error.code : 'unreachable';
    if (code === 'invalid_grant' || code === 'invalid_token') {
      await sql`update citedevidence_links set plan_active = false, refresh_token_encrypted = null, check_error = 'signed_out' where user_id = ${userId}`;
    } else {
      await sql`update citedevidence_links set check_error = ${code.slice(0, 60)} where user_id = ${userId}`;
    }
    forgetAccess();
    console.warn('CitedEvidence plan check failed:', (error as Error).message);
  }
}

export type CeAccess = { allowed: boolean; admin: boolean; linked: boolean; plan: { name: string | null; tier: string | null; active: boolean; checked_at: Date | null } | null };

// effectivePlan runs on every AI request: keep each account's answer for a short while.
const cache = new Map<string, { at: number; access: CeAccess }>();
export function forgetAccess() {
  cache.clear();
}

/** Whether an account may use Videmak through CitedEvidence (its plan, or a Videmak admin). */
export async function ceAccess(accountId: string): Promise<CeAccess> {
  const hit = cache.get(accountId);
  if (hit && Date.now() - hit.at < 30_000) return hit.access;
  const rows = await sql<{ user_id: string; is_admin: boolean; plan_name: string | null; plan_tier: string | null; plan_active: boolean | null; plan_admin: boolean | null; plan_checked_at: Date | null; attempted_at: Date | null }[]>`
    select u.id as user_id, u.is_admin, l.plan_name, l.plan_tier, l.plan_active, l.plan_admin, l.plan_checked_at, l.attempted_at
    from users u left join citedevidence_links l on l.user_id = u.id
    where u.account_id = ${accountId} and u.disabled_at is null`;
  const minimum = RANK[ceMinTier()];
  const fresh = (at: Date | null) => Boolean(at && Date.now() - at.getTime() < STALE_AFTER_MS);
  const linked = rows.find((row) => row.plan_checked_at);
  const access: CeAccess = {
    admin: rows.some((row) => row.is_admin),
    linked: Boolean(linked),
    allowed: rows.some((row) => row.is_admin || (row.plan_active && fresh(row.plan_checked_at)
      && (row.plan_admin || (row.plan_tier !== null && RANK[row.plan_tier] >= minimum)))),
    plan: linked ? { name: linked.plan_name, tier: linked.plan_tier, active: Boolean(linked.plan_active), checked_at: linked.plan_checked_at } : null,
  };
  cache.set(accountId, { at: Date.now(), access });
  if (cache.size > 5000) cache.clear();
  // Due for its hourly check: read it again in the background (the answer above stands for now).
  for (const row of rows) {
    if (row.plan_checked_at && (!row.attempted_at || Date.now() - row.attempted_at.getTime() > RECHECK_AFTER_MS)) {
      void refreshCeLink(row.user_id).catch((error) => console.warn('CitedEvidence plan check failed:', (error as Error).message));
    }
  }
  return access;
}
