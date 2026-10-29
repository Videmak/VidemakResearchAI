import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { sql } from '../db.js';
import type { AuthUser } from '../auth.js';
import { settings, type EffectiveSettings } from './settings.js';
import { activeUser, createUser } from './users.js';

/**
 * Sign-in methods: which are usable (Admin › Sign-in switches + keys), Google / Microsoft /
 * Apple through OpenID Connect (state, nonce, PKCE where supported), one-time flows kept in
 * the database, and one account per email (a provider's verified email links to it).
 */

export type Provider = 'google' | 'microsoft' | 'apple';
export const PROVIDERS: Provider[] = ['google', 'microsoft', 'apple'];
export type Methods = { password: boolean; passkeys: boolean } & Record<Provider, boolean>;

const isOn = (value: string | undefined) => (value ?? '').trim().toLowerCase() !== 'off';

export function providerConfigured(provider: Provider, s: EffectiveSettings = settings()) {
  if (provider === 'google') return Boolean(s.googleClientId && s.googleClientSecret);
  if (provider === 'microsoft') return Boolean(s.microsoftClientId && s.microsoftClientSecret);
  return Boolean(s.appleServicesId && s.appleTeamId && s.appleKeyId && s.applePrivateKey);
}

const SWITCH: Record<Provider, 'signinGoogle' | 'signinMicrosoft' | 'signinApple'> = { google: 'signinGoogle', microsoft: 'signinMicrosoft', apple: 'signinApple' };

/** A provider shows only when it is switched on AND has its keys. */
export function providerUsable(provider: Provider, s: EffectiveSettings = settings()) {
  return isOn(s[SWITCH[provider]]) && providerConfigured(provider, s);
}

/** Usable methods. Email and password stays on when nothing else can create an account. */
export function methodsFor(s: EffectiveSettings = settings()): Methods {
  const providers = Object.fromEntries(PROVIDERS.map((provider) => [provider, providerUsable(provider, s)])) as Record<Provider, boolean>;
  const anyProvider = PROVIDERS.some((provider) => providers[provider]);
  return { password: isOn(s.signinPassword) || !anyProvider, passkeys: isOn(s.signinPasskeys), ...providers };
}

/** For the admin page: turning email and password off needs a provider that can sign people up. */
export function passwordSwitchProblem(s: EffectiveSettings): string | null {
  if (isOn(s.signinPassword)) return null;
  if (PROVIDERS.some((provider) => providerUsable(provider, s))) return null;
  return 'Turn on and set up Google, Microsoft or Apple before turning off email and password.';
}

// --- One-time flows -------------------------------------------------------------------

export const hashValue = (value: string) => createHash('sha256').update(value).digest('base64url');
const randomId = (bytes = 24) => randomBytes(bytes).toString('base64url');

export type Flow = { id: string; kind: string; provider: string | null; data: Record<string, any>; user_id: string | null };

export async function createFlow(kind: string, data: Record<string, unknown>, options: { provider?: string; userId?: string | null; ttlSeconds: number }) {
  const id = randomId();
  await sql`
    insert into auth_flows (id, kind, provider, data, user_id, expires_at)
    values (${id}, ${kind}, ${options.provider ?? null}, ${sql.json(data as any)}, ${options.userId ?? null}, now() + make_interval(secs => ${options.ttlSeconds}))`;
  if (Math.random() < 0.02) await sql`delete from auth_flows where expires_at < now() - interval '1 day'`.catch(() => undefined);
  return id;
}

/** Uses a flow once: null when unknown, expired, already used or of another kind. */
export async function takeFlow(id: string | null | undefined, kind: string): Promise<Flow | null> {
  if (!id || id.length > 100) return null;
  const [row] = await sql<Flow[]>`
    update auth_flows set used_at = now()
    where id = ${id} and kind = ${kind} and used_at is null and expires_at > now()
    returning id, kind, provider, data, user_id`;
  return row ?? null;
}

/** Only same-site paths after sign-in (no open redirects). */
export function safeNext(raw: unknown): string {
  const value = typeof raw === 'string' ? raw : '';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || value.length > 500) return '/editor';
  return value;
}

// --- OpenID Connect -------------------------------------------------------------------

const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

const ENDPOINTS: Record<Provider, { authorize: string; token: string; jwks: string; scope: string; formPost: boolean; pkce: boolean }> = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    jwks: 'https://www.googleapis.com/oauth2/v3/certs', scope: 'openid email profile', formPost: false, pkce: true,
  },
  microsoft: {
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    jwks: 'https://login.microsoftonline.com/common/discovery/v2.0/keys', scope: 'openid email profile', formPost: false, pkce: true,
  },
  // Apple posts the answer back (form_post) and does not document PKCE; state and nonce protect it.
  apple: {
    authorize: 'https://appleid.apple.com/auth/authorize', token: 'https://appleid.apple.com/auth/token',
    jwks: 'https://appleid.apple.com/auth/keys', scope: 'name email', formPost: true, pkce: false,
  },
};

const jwksCache = new Map<Provider, ReturnType<typeof createRemoteJWKSet>>();
const jwks = (provider: Provider) => {
  if (!jwksCache.has(provider)) jwksCache.set(provider, createRemoteJWKSet(new URL(ENDPOINTS[provider].jwks)));
  return jwksCache.get(provider)!;
};

export const redirectUri = (provider: Provider, s: EffectiveSettings = settings()) => `${s.publicUrl.replace(/\/+$/, '')}/api/auth/oauth/${provider}/callback`;

function clientId(provider: Provider, s: EffectiveSettings) {
  return provider === 'google' ? s.googleClientId : provider === 'microsoft' ? s.microsoftClientId : s.appleServicesId;
}

/** Apple's .p8 key as pasted (newlines may have become spaces or "\n"). */
export function normalizePem(raw: string) {
  const body = raw.replace(/\\n/g, '\n').replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)?.join('\n') ?? ''}\n-----END PRIVATE KEY-----\n`;
}

/** Apple's client secret is a short-lived ES256 token signed with the team's key. */
async function appleClientSecret(s: EffectiveSettings) {
  const key = await importPKCS8(normalizePem(s.applePrivateKey), 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: s.appleKeyId })
    .setIssuer(s.appleTeamId).setSubject(s.appleServicesId).setAudience('https://appleid.apple.com')
    .setIssuedAt().setExpirationTime('10m').sign(key);
}

async function clientSecret(provider: Provider, s: EffectiveSettings) {
  return provider === 'google' ? s.googleClientSecret : provider === 'microsoft' ? s.microsoftClientSecret : appleClientSecret(s);
}

/** Starts a provider round trip; returns the provider's sign-in page. */
export async function startOAuth(provider: Provider, input: { mode: 'signin' | 'connect'; next?: string; binding?: string; userId?: string | null }) {
  const s = settings();
  if (!providerUsable(provider, s)) throw new Error('This sign-in method is not available.');
  const verifier = randomId(32);
  const nonce = randomId(16);
  const state = await createFlow('oauth', {
    verifier, nonce, mode: input.mode, next: safeNext(input.next), binding: input.binding ? hashValue(input.binding) : null,
  }, { provider, userId: input.userId ?? null, ttlSeconds: 600 });
  const endpoint = ENDPOINTS[provider];
  const url = new URL(endpoint.authorize);
  url.searchParams.set('client_id', clientId(provider, s));
  url.searchParams.set('redirect_uri', redirectUri(provider, s));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', endpoint.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  if (endpoint.formPost) url.searchParams.set('response_mode', 'form_post');
  if (endpoint.pkce) {
    url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  if (provider === 'google' || provider === 'microsoft') url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export type Profile = { provider: Provider; subject: string; email: string | null; emailVerified: boolean; name: string | null };

/** What a provider's ID token says, once its signature, audience, issuer and nonce check out. */
export async function profileFromIdToken(provider: Provider, idToken: string, nonce: string, extra: { appleName?: string | null } = {}, s: EffectiveSettings = settings()): Promise<Profile> {
  const audience = clientId(provider, s);
  const { payload } = await jwtVerify(idToken, jwks(provider), {
    audience,
    issuer: provider === 'google' ? ['https://accounts.google.com', 'accounts.google.com'] : provider === 'apple' ? 'https://appleid.apple.com' : undefined,
  });
  return profileFromClaims(provider, payload, nonce, extra);
}

/** The checks after the signature: nonce, Microsoft's issuer, and when an email counts as verified. */
export function profileFromClaims(provider: Provider, payload: JWTPayload & Record<string, any>, nonce: string, extra: { appleName?: string | null } = {}): Profile {
  if (payload.nonce !== nonce) throw new Error('The sign-in answer did not match this browser. Try again.');
  if (!payload.sub) throw new Error('The provider did not say who you are.');
  if (provider === 'microsoft' && payload.iss !== `https://login.microsoftonline.com/${payload.tid}/v2.0`) throw new Error('Unexpected Microsoft issuer.');
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null;
  let emailVerified = false;
  if (provider === 'google') emailVerified = payload.email_verified === true;
  // Apple sends "true" as a string; Microsoft's email is trusted only for personal accounts or
  // when the organisation verified the domain (xms_edov), so no one can claim another's email.
  if (provider === 'apple') emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  if (provider === 'microsoft') emailVerified = Boolean(email) && (payload.tid === MICROSOFT_CONSUMER_TENANT || payload.xms_edov === true || payload.xms_edov === 1 || payload.xms_edov === '1' || payload.xms_edov === 'true');
  const name = typeof payload.name === 'string' ? payload.name : extra.appleName ?? null;
  return { provider, subject: String(payload.sub), email, emailVerified, name: name?.trim() || null };
}

/** Trades the code for tokens and returns the verified profile. */
export async function finishOAuth(provider: Provider, flow: Flow, code: string, extra: { appleName?: string | null } = {}): Promise<Profile> {
  const s = settings();
  const form = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: redirectUri(provider, s),
    client_id: clientId(provider, s), client_secret: await clientSecret(provider, s),
  });
  if (ENDPOINTS[provider].pkce) form.set('code_verifier', flow.data.verifier);
  const response = await fetch(ENDPOINTS[provider].token, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form,
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null) as { id_token?: string; error?: string; error_description?: string } | null;
  if (!response.ok || !body?.id_token) {
    console.warn(`${provider} token exchange failed`, response.status, body?.error, body?.error_description?.slice(0, 200));
    throw new Error(`${PROVIDER_NAMES[provider]} sign-in did not finish. Try again.`);
  }
  return profileFromIdToken(provider, body.id_token, flow.data.nonce, extra, s);
}

export const PROVIDER_NAMES: Record<Provider, string> = { google: 'Google', microsoft: 'Microsoft', apple: 'Apple' };

/**
 * The person a provider profile belongs to: the linked identity, else the account with the
 * same verified email (linked now), else a new account. Unverified emails never link.
 */
export async function userForProfile(profile: Profile): Promise<{ user: AuthUser; created: boolean }> {
  const [linked] = await sql<{ user_id: string }[]>`select user_id from user_identities where provider = ${profile.provider} and subject = ${profile.subject}`;
  if (linked) {
    const user = await activeUser(linked.user_id);
    if (!user) throw new Error('This account is turned off.');
    await sql`update user_identities set last_used_at = now(), email = coalesce(${profile.email}, email) where provider = ${profile.provider} and subject = ${profile.subject}`;
    return { user, created: false };
  }
  if (!profile.email || !profile.emailVerified) {
    throw new Error(`${PROVIDER_NAMES[profile.provider]} did not confirm your email address. Sign in another way, then connect ${PROVIDER_NAMES[profile.provider]} on your Account page.`);
  }
  const [existing] = await sql<{ id: string; disabled_at: Date | null }[]>`select id, disabled_at from users where email = ${profile.email}`;
  let user: AuthUser | null;
  let created = false;
  if (existing) {
    if (existing.disabled_at) throw new Error('This account is turned off.');
    user = await activeUser(existing.id);
    await sql`update users set email_verified_at = coalesce(email_verified_at, now()) where id = ${existing.id}`;
  } else {
    user = await createUser({ email: profile.email, fullName: profile.name, passwordHash: null, emailVerified: true });
    created = true;
  }
  if (!user) throw new Error('This account is turned off.');
  await linkIdentity(user.id, profile);
  return { user, created };
}

/** Adds a provider to a person (Account › Sign-in methods, or a first provider sign-in). */
export async function linkIdentity(userId: string, profile: Profile) {
  const [taken] = await sql<{ user_id: string }[]>`select user_id from user_identities where provider = ${profile.provider} and subject = ${profile.subject}`;
  if (taken && taken.user_id !== userId) throw new Error(`This ${PROVIDER_NAMES[profile.provider]} account is already connected to another Videmak account.`);
  await sql`
    insert into user_identities (user_id, provider, subject, email, last_used_at) values (${userId}, ${profile.provider}, ${profile.subject}, ${profile.email}, now())
    on conflict (user_id, provider) do update set subject = excluded.subject, email = excluded.email, last_used_at = now()`;
}

/** The name Apple sends only on the first authorization (a JSON form field). */
export function appleNameFrom(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  try {
    const parsed = JSON.parse(raw) as { name?: { firstName?: string; lastName?: string } };
    const name = [parsed.name?.firstName, parsed.name?.lastName].filter(Boolean).join(' ').trim();
    return name || null;
  } catch {
    return null;
  }
}
