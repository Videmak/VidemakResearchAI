import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'test-secret-for-sign-in-methods-0123456789';
  process.env.PUBLIC_URL = 'https://videmak.test';
  // A fake postgres.js with just the tables sign-in uses.
  const state = {
    flows: new Map<string, any>(),
    users: [] as any[],
    identities: [] as any[],
    passkeys: [] as any[],
    nextId: 1,
  };
  const text = (strings: TemplateStringsArray) => strings.join('?').replace(/\s+/g, ' ');
  const sql: any = (strings: TemplateStringsArray, ...values: any[]) => {
    const q = text(strings);
    if (q.includes('insert into auth_flows')) {
      const [id, kind, provider, data, userId] = values;
      state.flows.set(id, { id, kind, provider, data, user_id: userId, used_at: null, expired: false });
      return Promise.resolve([]);
    }
    if (q.includes('delete from auth_flows')) return Promise.resolve([]);
    if (q.includes('update auth_flows set used_at')) {
      const [id, kind] = values;
      const flow = state.flows.get(id);
      if (!flow || flow.kind !== kind || flow.used_at || flow.expired) return Promise.resolve([]);
      flow.used_at = new Date();
      return Promise.resolve([{ id: flow.id, kind: flow.kind, provider: flow.provider, data: flow.data, user_id: flow.user_id }]);
    }
    if (q.includes('select user_id from user_identities where provider')) {
      const [provider, subject] = values;
      return Promise.resolve(state.identities.filter((row) => row.provider === provider && row.subject === subject));
    }
    if (q.includes('update user_identities set last_used_at')) return Promise.resolve([]);
    if (q.includes('insert into user_identities')) {
      const [userId, provider, subject, email] = values;
      state.identities = state.identities.filter((row) => !(row.user_id === userId && row.provider === provider));
      state.identities.push({ user_id: userId, provider, subject, email });
      return Promise.resolve([]);
    }
    if (q.includes('select provider from user_identities where user_id')) return Promise.resolve(state.identities.filter((row) => row.user_id === values[0]));
    if (q.includes('from user_passkeys where user_id')) return Promise.resolve([{ count: state.passkeys.filter((row) => row.user_id === values[0]).length }]);
    if (q.includes('select id, disabled_at from users where email')) return Promise.resolve(state.users.filter((row) => row.email === values[0]));
    if (q.includes('password_hash is not null as has_password')) {
      return Promise.resolve(state.users.filter((row) => row.email === values[0] && !row.disabled_at).map((row) => ({ id: row.id, has_password: Boolean(row.password_hash) })));
    }
    if (q.includes('update users set email_verified_at')) return Promise.resolve([]);
    if (q.includes('from users where id = ? and disabled_at is null')) {
      return Promise.resolve(state.users.filter((row) => row.id === values[0] && !row.disabled_at).map(({ id, email, full_name, account_id, is_admin }) => ({ id, email, full_name, account_id, is_admin })));
    }
    if (q.includes('insert into accounts')) return Promise.resolve([{ id: `acc-${state.nextId++}` }]);
    if (q.includes('insert into users')) {
      const [accountId, email, fullName, passwordHash] = values;
      const user = { id: `user-${state.nextId++}`, account_id: accountId, email, full_name: fullName, password_hash: passwordHash, is_admin: false, disabled_at: null };
      state.users.push(user);
      return Promise.resolve([{ id: user.id, email, full_name: fullName, account_id: accountId, is_admin: false }]);
    }
    // last_seen_at, invitations, admin sync
    return Promise.resolve([]);
  };
  sql.json = (value: unknown) => value;
  sql.begin = (run: (tx: any) => unknown) => run(sql);
  return { state, sql };
});

vi.mock('../src/db.js', () => ({ sql: db.sql }));
vi.mock('../src/lib/plans.js', () => ({ effectivePlan: async () => ({ plan: { id: 'free', name: 'Free' } }) }));

// The token exchange and ID-token check talk to the providers; here they return a set profile.
const exchange = vi.hoisted(() => ({ profile: null as any, calls: [] as any[] }));
vi.mock('../src/lib/signin.js', async (original) => {
  const real = await original<typeof import('../src/lib/signin.js')>();
  return {
    ...real,
    finishOAuth: vi.fn(async (provider: string, flow: any, code: string, extra: any) => {
      exchange.calls.push({ provider, flow, code, extra });
      if (!exchange.profile) throw new Error('Google sign-in did not finish. Try again.');
      return { provider, ...exchange.profile };
    }),
  };
});

const settingsState = vi.hoisted(() => ({ overrides: {} as Record<string, string> }));
vi.mock('../src/lib/settings.js', async () => {
  const { env } = await import('../src/env.js');
  return { settings: () => ({ ...env, ...settingsState.overrides }) };
});

import { Hono } from 'hono';
import { env } from '../src/env.js';
import {
  methodsFor, normalizePem, passwordSwitchProblem, profileFromClaims, startOAuth, userForProfile, hashValue,
} from '../src/lib/signin.js';
import { signinRoutes } from '../src/routes/signin.js';

const GOOGLE = { googleClientId: 'google-id', googleClientSecret: 'google-secret' };
const app = new Hono().route('/api/auth', signinRoutes());
const json = (path: string, body: unknown) => app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` } });

beforeEach(() => {
  db.state.flows.clear();
  db.state.users = [];
  db.state.identities = [];
  db.state.passkeys = [];
  settingsState.overrides = {};
  exchange.profile = null;
  exchange.calls = [];
});

describe('which methods show', () => {
  const s = (values: Record<string, string>) => ({ ...env, ...values });

  it('shows a provider only when it is on and has its keys; password and passkeys are on by default', () => {
    expect(methodsFor(s({}))).toEqual({ password: true, passkeys: true, google: false, microsoft: false, apple: false });
    expect(methodsFor(s(GOOGLE)).google).toBe(true);
    expect(methodsFor(s({ ...GOOGLE, signinGoogle: 'off' })).google).toBe(false);
    expect(methodsFor(s({ appleServicesId: 'a', appleTeamId: 'b', appleKeyId: 'c' })).apple).toBe(false);
    expect(methodsFor(s({ signinPasskeys: 'off' })).passkeys).toBe(false);
  });

  it('keeps email and password on while no provider can sign people up', () => {
    expect(methodsFor(s({ signinPassword: 'off' })).password).toBe(true);
    expect(passwordSwitchProblem(s({ signinPassword: 'off' }))).toMatch(/before turning off email and password/);
    expect(methodsFor(s({ ...GOOGLE, signinPassword: 'off' })).password).toBe(false);
    expect(passwordSwitchProblem(s({ ...GOOGLE, signinPassword: 'off' }))).toBeNull();
  });
});

describe('provider answers', () => {
  it('checks the nonce and when an email counts as verified', () => {
    expect(() => profileFromClaims('google', { sub: '1', nonce: 'other' }, 'n')).toThrow(/did not match this browser/);
    expect(profileFromClaims('google', { sub: '1', nonce: 'n', email: 'A@X.org', email_verified: true }, 'n')).toMatchObject({ email: 'a@x.org', emailVerified: true });
    expect(profileFromClaims('apple', { sub: '2', nonce: 'n', email: 'b@privaterelay.appleid.com', email_verified: 'true' }, 'n', { appleName: 'Ada L' }))
      .toMatchObject({ emailVerified: true, name: 'Ada L' });
    const tenant = 'aaaaaaaa-0000-0000-0000-000000000000';
    const work = { sub: '3', nonce: 'n', email: 'c@uni.edu', tid: tenant, iss: `https://login.microsoftonline.com/${tenant}/v2.0` };
    expect(profileFromClaims('microsoft', work, 'n').emailVerified).toBe(false);
    expect(profileFromClaims('microsoft', { ...work, xms_edov: true }, 'n').emailVerified).toBe(true);
    const consumer = '9188040d-6c67-4c5b-b112-36a304b66dad';
    expect(profileFromClaims('microsoft', { ...work, tid: consumer, iss: `https://login.microsoftonline.com/${consumer}/v2.0` }, 'n').emailVerified).toBe(true);
    expect(() => profileFromClaims('microsoft', { ...work, iss: 'https://evil.example/v2.0' }, 'n')).toThrow(/issuer/);
  });

  it('rebuilds an Apple key pasted on one line', () => {
    const pem = normalizePem('-----BEGIN PRIVATE KEY----- MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg abc -----END PRIVATE KEY-----');
    expect(pem.startsWith('-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgabc\n')).toBe(true);
  });
});

describe('starting a provider sign-in', () => {
  it('sends Google a state, nonce and PKCE challenge, and Apple a form-post request', async () => {
    settingsState.overrides = { ...GOOGLE, appleServicesId: 'net.videmak.web', appleTeamId: 'TEAM', appleKeyId: 'KEY', applePrivateKey: 'x' };
    const google = new URL(await startOAuth('google', { mode: 'signin', next: '/editor?doc=1', binding: 'b'.repeat(32) }));
    expect(google.origin).toBe('https://accounts.google.com');
    expect(google.searchParams.get('redirect_uri')).toBe('https://videmak.test/api/auth/oauth/google/callback');
    expect(google.searchParams.get('code_challenge_method')).toBe('S256');
    const flow = db.state.flows.get(google.searchParams.get('state')!);
    expect(flow).toMatchObject({ kind: 'oauth', provider: 'google', data: { next: '/editor?doc=1', binding: hashValue('b'.repeat(32)) } });
    expect(flow.data.nonce).toBe(google.searchParams.get('nonce'));
    const apple = new URL(await startOAuth('apple', { mode: 'signin', binding: 'b'.repeat(32), next: 'https://evil.example' }));
    expect(apple.searchParams.get('response_mode')).toBe('form_post');
    expect(apple.searchParams.get('code_challenge')).toBeNull();
    expect(db.state.flows.get(apple.searchParams.get('state')!).data.next).toBe('/editor');
  });

  it('refuses a provider that is off or has no keys', async () => {
    await expect(startOAuth('microsoft', { mode: 'signin', binding: 'b'.repeat(32) })).rejects.toThrow(/not available/);
    const response = await json('/api/auth/oauth/microsoft/start', { binding: 'b'.repeat(32) });
    expect(response.status).toBe(422);
  });
});

describe('one account per email', () => {
  it('links a verified email to the existing account, refuses unverified ones, and creates new accounts', async () => {
    db.state.users.push({ id: 'user-a', account_id: 'acc-a', email: 'ada@uni.edu', full_name: 'Ada', password_hash: 'h', is_admin: false, disabled_at: null });
    const linked = await userForProfile({ provider: 'google', subject: 'g-1', email: 'ada@uni.edu', emailVerified: true, name: 'Ada' });
    expect(linked).toMatchObject({ user: { id: 'user-a' }, created: false });
    expect(db.state.identities).toEqual([{ user_id: 'user-a', provider: 'google', subject: 'g-1', email: 'ada@uni.edu' }]);
    // Next time the identity itself finds the person, even with another email.
    expect((await userForProfile({ provider: 'google', subject: 'g-1', email: 'new@x.org', emailVerified: false, name: null })).user.id).toBe('user-a');
    await expect(userForProfile({ provider: 'microsoft', subject: 'm-1', email: 'ada@uni.edu', emailVerified: false, name: null })).rejects.toThrow(/did not confirm your email/);
    const created = await userForProfile({ provider: 'apple', subject: 'a-1', email: 'grace@x.org', emailVerified: true, name: 'Grace' });
    expect(created.created).toBe(true);
    expect(db.state.users.find((user) => user.email === 'grace@x.org')).toMatchObject({ password_hash: null, full_name: 'Grace' });
  });
});

describe('callback and ticket', () => {
  it('finishes a Google sign-in into a one-time ticket that only the starting browser can use', async () => {
    settingsState.overrides = GOOGLE;
    const binding = 'browser-binding-value-0123456789';
    const start = await json('/api/auth/oauth/google/start', { binding, next: '/account' });
    const state = new URL(((await start.json()) as any).authorization_url).searchParams.get('state')!;
    exchange.profile = { subject: 'g-9', email: 'lin@x.org', emailVerified: true, name: 'Lin' };
    const back = await app.request(`/api/auth/oauth/google/callback?state=${state}&code=abc`);
    const page = await back.text();
    const ticket = /#ticket=([\w-]+)/.exec(page)?.[1];
    expect(ticket).toBeTruthy();
    expect(page).not.toContain('token');
    // A replayed callback is refused.
    expect(await (await app.request(`/api/auth/oauth/google/callback?state=${state}&code=abc`)).text()).toContain('/login#error=');
    expect((await json('/api/auth/ticket', { ticket, binding: 'someone-elses-binding-0123456789' })).status).toBe(401);
    // The failed attempt used the ticket up, so start again for the good case.
    const start2 = await json('/api/auth/oauth/google/start', { binding, next: '/account' });
    const state2 = new URL(((await start2.json()) as any).authorization_url).searchParams.get('state')!;
    const ticket2 = /#ticket=([\w-]+)/.exec(await (await app.request(`/api/auth/oauth/google/callback?state=${state2}&code=abc`)).text())?.[1];
    const redeemed = await json('/api/auth/ticket', { ticket: ticket2, binding });
    expect(redeemed.status).toBe(200);
    expect(await redeemed.json()).toMatchObject({ next: '/account', user: { email: 'lin@x.org', plan: 'free' }, token: expect.any(String) });
  });

  it('reads Apple\'s form post and its first-time name, and reports a cancelled sign-in', async () => {
    settingsState.overrides = { appleServicesId: 'net.videmak.web', appleTeamId: 'TEAM', appleKeyId: 'KEY', applePrivateKey: 'x' };
    const start = await json('/api/auth/oauth/apple/start', { binding: 'b'.repeat(32) });
    const state = new URL(((await start.json()) as any).authorization_url).searchParams.get('state')!;
    exchange.profile = { subject: 'a-7', email: 'r@privaterelay.appleid.com', emailVerified: true, name: null };
    const form = new URLSearchParams({ state, code: 'xyz', user: JSON.stringify({ name: { firstName: 'Rosa', lastName: 'P' } }) });
    const page = await (await app.request('/api/auth/oauth/apple/callback', { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } })).text();
    expect(page).toContain('/auth/finish#ticket=');
    expect(exchange.calls.at(-1).extra.appleName).toBe('Rosa P');
    const start2 = await json('/api/auth/oauth/apple/start', { binding: 'b'.repeat(32) });
    const state2 = new URL(((await start2.json()) as any).authorization_url).searchParams.get('state')!;
    const cancelled = await (await app.request('/api/auth/oauth/apple/callback', { method: 'POST', body: new URLSearchParams({ state: state2, error: 'user_cancelled_authorize' }), headers: { 'content-type': 'application/x-www-form-urlencoded' } })).text();
    expect(cancelled).toContain(encodeURIComponent('Apple sign-in was cancelled.'));
  });
});

describe('methods and email lookup endpoints', () => {
  it('lists usable methods and tells the form what an email can do next', async () => {
    expect(await (await app.request('/api/auth/methods')).json()).toEqual({ password: true, passkeys: true, google: false, microsoft: false, apple: false, turnstile_site_key: null, password_reset: false, support_email: null });
    db.state.users.push({ id: 'user-p', account_id: 'acc', email: 'pw@x.org', password_hash: 'h', disabled_at: null });
    db.state.users.push({ id: 'user-g', account_id: 'acc', email: 'g@x.org', password_hash: null, disabled_at: null });
    db.state.identities.push({ user_id: 'user-g', provider: 'google', subject: 's', email: 'g@x.org' });
    settingsState.overrides = GOOGLE;
    expect(await (await json('/api/auth/identify', { email: 'new@x.org' })).json()).toMatchObject({ next_step: 'signup' });
    expect(await (await json('/api/auth/identify', { email: 'PW@x.org' })).json()).toMatchObject({ next_step: 'password', password_available: true });
    expect(await (await json('/api/auth/identify', { email: 'g@x.org' })).json()).toMatchObject({ next_step: 'provider', providers: ['google'], password_available: false });
  });

  it('offers a linked provider first, with the password as the other way', async () => {
    db.state.users.push({ id: 'user-b', account_id: 'acc', email: 'both@x.org', password_hash: 'h', disabled_at: null });
    db.state.identities.push({ user_id: 'user-b', provider: 'google', subject: 's2', email: 'both@x.org' });
    settingsState.overrides = GOOGLE;
    expect(await (await json('/api/auth/identify', { email: 'both@x.org' })).json()).toMatchObject({
      next_step: 'provider', account_exists: true, linked: true, providers: ['google'], password_available: true,
    });
    // Google switched off: the same account just asks for its password.
    settingsState.overrides = { ...GOOGLE, signinGoogle: 'off' };
    expect(await (await json('/api/auth/identify', { email: 'both@x.org' })).json()).toMatchObject({ next_step: 'password', linked: false });
    expect(await (await json('/api/auth/identify', { email: 'new@x.org' })).json()).toMatchObject({ next_step: 'signup', account_exists: false });
  });
});

describe('Cloudflare Turnstile', () => {
  const TURNSTILE = { signinTurnstile: 'on', turnstileSiteKey: 'site-key', turnstileSecretKey: 'secret-key' };
  afterEach(() => vi.unstubAllGlobals());

  it('is off until switched on with both keys, and then needs a token Cloudflare accepts', async () => {
    settingsState.overrides = { signinTurnstile: 'on', turnstileSiteKey: 'site-key' };
    expect(((await (await app.request('/api/auth/methods')).json()) as any).turnstile_site_key).toBeNull();
    settingsState.overrides = { turnstileSiteKey: 'site-key', turnstileSecretKey: 'secret-key' };
    expect(((await (await app.request('/api/auth/methods')).json()) as any).turnstile_site_key).toBeNull();
    expect((await json('/api/auth/identify', { email: 'new@x.org' })).status).toBe(200);

    settingsState.overrides = TURNSTILE;
    expect(((await (await app.request('/api/auth/methods')).json()) as any).turnstile_site_key).toBe('site-key');
    const missing = await json('/api/auth/identify', { email: 'new@x.org' });
    expect(missing.status).toBe(422);

    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ success: init.body.get('response') === 'good' }), { status: 200 });
    }));
    expect((await json('/api/auth/identify', { email: 'new@x.org', turnstile_token: 'good' })).status).toBe(200);
    expect(calls[0].url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(calls[0].body).toContain('secret=secret-key');
    expect((await json('/api/auth/identify', { email: 'new@x.org', turnstile_token: 'bad' })).status).toBe(422);

    // Cloudflare unreachable: refused.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect((await json('/api/auth/identify', { email: 'new@x.org', turnstile_token: 'good' })).status).toBe(422);
  });
});
