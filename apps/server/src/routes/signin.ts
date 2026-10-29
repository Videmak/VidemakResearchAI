import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { mailReady } from '../lib/mail.js';
import { env } from '../env.js';
import { z } from 'zod';
import { sql } from '../db.js';
import { optionalUser, requireUser, signSession, type AppVariables } from '../auth.js';
import { rateLimit } from '../lib/rateLimit.js';
import {
  appleNameFrom, finishOAuth, hashValue, linkIdentity, methodsFor, PROVIDER_NAMES, PROVIDERS, safeNext, startOAuth, takeFlow,
  createFlow, userForProfile, type Provider,
} from '../lib/signin.js';
import { authenticationOptions, finishAuthentication, finishRegistration, registrationOptions } from '../lib/passkeys.js';
import { activeUser, publicUser, signedIn } from '../lib/users.js';
import { requireHuman, turnstileSiteKey } from '../lib/turnstile.js';

const providerParam = z.enum(['google', 'microsoft', 'apple']);
const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback).slice(0, 300);

/** A same-site page that sends the browser on (the web app's proxy would follow a 302 itself). */
function goTo(c: Context, path: string) {
  const target = JSON.stringify(path).replace(/</g, '\\u003c');
  const attribute = path.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  return c.html(`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${attribute}"><title>Signing in…</title><script>location.replace(${target})</script>`);
}

/** Sign-in methods: which exist, email lookup, Google/Microsoft/Apple, passkeys, connected methods. */
export function signinRoutes() {
  const app = new Hono<{ Variables: AppVariables }>();

  // password_reset: email is set up, so "Forgot password?" can send a link.
  app.get('/methods', (c) => c.json({ ...methodsFor(), turnstile_site_key: turnstileSiteKey(), password_reset: mailReady(), support_email: env.supportEmail || null }));

  /** First step of the one sign-in form: what this email can do next. */
  app.post('/identify', rateLimit({ key: 'identify', limit: 30, windowSeconds: 600 }), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).safeParse(body);
    if (!parsed.success) throw new HTTPException(422, { message: 'Enter a valid email address.' });
    await requireHuman(c, body?.turnstile_token);
    const methods = methodsFor();
    const usableProviders = PROVIDERS.filter((provider) => methods[provider]);
    const [user] = await sql<{ id: string; has_password: boolean }[]>`
      select id, password_hash is not null as has_password from users where email = ${parsed.data.email} and disabled_at is null`;
    if (!user) {
      return c.json({
        next_step: methods.password ? 'signup' : 'provider', account_exists: false, linked: false,
        providers: methods.password ? [] : usableProviders, password_available: false, passkey_available: false,
      });
    }
    const linked = await sql<{ provider: Provider }[]>`select provider from user_identities where user_id = ${user.id}`;
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from user_passkeys where user_id = ${user.id}`;
    const passwordAvailable = user.has_password && methods.password;
    const linkedUsable = linked.map((row) => row.provider).filter((provider) => methods[provider]);
    return c.json({
      // An account linked to Google (etc.) is offered that first, with its password as the other way.
      next_step: linkedUsable.length || !passwordAvailable ? 'provider' : 'password',
      account_exists: true,
      linked: linkedUsable.length > 0,
      // Without a usable linked provider any usable one works: its verified email links to this account.
      providers: linkedUsable.length ? linkedUsable : passwordAvailable ? [] : usableProviders,
      password_available: passwordAvailable,
      passkey_available: methods.passkeys && count > 0,
    });
  });

  app.post('/oauth/:provider/start', rateLimit({ key: 'oauth-start', limit: 30, windowSeconds: 600 }), optionalUser, async (c) => {
    const provider = providerParam.safeParse(c.req.param('provider'));
    if (!provider.success) throw new HTTPException(404, { message: 'Unknown sign-in method.' });
    const body = z.object({
      mode: z.enum(['signin', 'connect']).default('signin'), next: z.string().max(500).optional(), binding: z.string().min(16).max(200).optional(),
    }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new HTTPException(422, { message: 'Try again.' });
    const user = c.get('user');
    if (body.data.mode === 'connect' && !user) throw new HTTPException(401, { message: 'Sign in to continue.' });
    if (body.data.mode === 'signin' && !body.data.binding) throw new HTTPException(422, { message: 'Try again.' });
    try {
      const url = await startOAuth(provider.data, { mode: body.data.mode, next: body.data.next, binding: body.data.binding, userId: body.data.mode === 'connect' ? user!.id : null });
      return c.json({ authorization_url: url });
    } catch (error) {
      throw new HTTPException(422, { message: message(error, 'This sign-in method is not available.') });
    }
  });

  /** The provider sends the browser back here (Apple with a form POST, the others with a GET). */
  const callback = async (c: Context<{ Variables: AppVariables }>, params: Record<string, unknown>) => {
    const provider = providerParam.safeParse(c.req.param('provider'));
    if (!provider.success) return goTo(c, '/login#error=' + encodeURIComponent('Unknown sign-in method.'));
    const flow = await takeFlow(typeof params.state === 'string' ? params.state : null, 'oauth');
    const connect = flow?.data.mode === 'connect';
    const fail = (text: string) => goTo(c, connect ? `/account#signin-error=${encodeURIComponent(text)}` : `/login#error=${encodeURIComponent(text)}`);
    if (!flow || flow.provider !== provider.data) return fail('This sign-in took too long or was already used. Try again.');
    if (typeof params.error === 'string') {
      const cancelled = ['access_denied', 'user_cancelled_authorize', 'user_cancelled_login'].includes(params.error);
      return fail(cancelled ? `${PROVIDER_NAMES[provider.data]} sign-in was cancelled.` : `${PROVIDER_NAMES[provider.data]} sign-in did not finish. Try again.`);
    }
    if (typeof params.code !== 'string' || params.code.length > 4000) return fail('Sign-in did not finish. Try again.');
    try {
      const profile = await finishOAuth(provider.data, flow, params.code, { appleName: appleNameFrom(params.user) });
      if (connect) {
        if (!flow.user_id || !(await activeUser(flow.user_id))) return fail('Sign in to continue.');
        await linkIdentity(flow.user_id, profile);
        return goTo(c, `/account#connected=${provider.data}`);
      }
      const { user } = await userForProfile(profile);
      const ticket = await createFlow('ticket', { next: safeNext(flow.data.next), binding: flow.data.binding }, { userId: user.id, ttlSeconds: 120 });
      return goTo(c, `/auth/finish#ticket=${ticket}`);
    } catch (error) {
      console.warn(`${provider.data} sign-in failed:`, (error as Error).message);
      return fail(message(error, 'Sign-in did not finish. Try again.'));
    }
  };
  app.get('/oauth/:provider/callback', (c) => callback(c, c.req.query()));
  app.post('/oauth/:provider/callback', async (c) => callback(c, await c.req.parseBody().catch(() => ({}))));

  /** The browser trades the one-time ticket (and its own binding value) for a session. */
  app.post('/ticket', rateLimit({ key: 'ticket', limit: 30, windowSeconds: 600 }), async (c) => {
    const body = z.object({ ticket: z.string().max(100), binding: z.string().max(200).nullable().optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new HTTPException(422, { message: 'Sign-in did not finish. Try again.' });
    const flow = await takeFlow(body.data.ticket, 'ticket');
    // The binding proves this browser started the sign-in (stops someone else's ticket being planted).
    if (!flow?.user_id || !flow.data.binding || !body.data.binding || hashValue(body.data.binding) !== flow.data.binding) {
      throw new HTTPException(401, { message: 'This sign-in expired or was started in another browser. Try again.' });
    }
    const found = await activeUser(flow.user_id);
    if (!found) throw new HTTPException(401, { message: 'This account is turned off.' });
    const user = await signedIn(found);
    return c.json({ token: await signSession(user), user: await publicUser(user), next: safeNext(flow.data.next) });
  });

  // Passkeys -------------------------------------------------------------------------------

  const passkeysOn = () => {
    if (!methodsFor().passkeys) throw new HTTPException(403, { message: 'Passkeys are turned off.' });
  };

  app.post('/passkeys/login/options', rateLimit({ key: 'passkey', limit: 60, windowSeconds: 600 }), async (c) => {
    passkeysOn();
    return c.json(await authenticationOptions());
  });

  app.post('/passkeys/login/verify', rateLimit({ key: 'passkey-verify', limit: 30, windowSeconds: 600 }), async (c) => {
    passkeysOn();
    const body = z.object({ flow: z.string().max(100), response: z.any() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success || !body.data.response?.id) throw new HTTPException(422, { message: 'Passkey sign-in did not finish. Try again.' });
    try {
      const user = await signedIn(await finishAuthentication(body.data.flow, body.data.response));
      return c.json({ token: await signSession(user), user: await publicUser(user) });
    } catch (error) {
      throw new HTTPException(401, { message: message(error, 'Passkey sign-in did not finish. Try again.') });
    }
  });

  app.post('/passkeys/register/options', requireUser, async (c) => {
    passkeysOn();
    return c.json(await registrationOptions(c.get('user')!));
  });

  app.post('/passkeys/register/verify', requireUser, async (c) => {
    passkeysOn();
    const body = z.object({ flow: z.string().max(100), response: z.any() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success || !body.data.response?.id) throw new HTTPException(422, { message: 'The passkey was not saved. Try again.' });
    try {
      return c.json({ passkey: await finishRegistration(c.get('user')!, body.data.flow, body.data.response) });
    } catch (error) {
      throw new HTTPException(422, { message: message(error, 'The passkey was not saved. Try again.') });
    }
  });

  // The signed-in person's methods (Account › Sign-in methods) ----------------------------

  /** How many ways in a person has, so the last one is never removed. */
  async function waysIn(userId: string) {
    const [row] = await sql<{ password: boolean; identities: number; passkeys: number }[]>`
      select (select password_hash is not null from users where id = ${userId}) as password,
        (select count(*)::int from user_identities where user_id = ${userId}) as identities,
        (select count(*)::int from user_passkeys where user_id = ${userId}) as passkeys`;
    return Number(row.password) + row.identities + row.passkeys;
  }

  app.get('/sign-in-methods/me', requireUser, async (c) => {
    const user = c.get('user')!;
    const [row] = await sql<{ password: boolean }[]>`select password_hash is not null as password from users where id = ${user.id}`;
    const identities = await sql<{ provider: Provider; email: string | null }[]>`select provider, email from user_identities where user_id = ${user.id}`;
    const passkeys = await sql`select id, name, created_at, last_used_at, backed_up from user_passkeys where user_id = ${user.id} order by created_at`;
    return c.json({
      password: row.password,
      providers: Object.fromEntries(PROVIDERS.map((provider) => {
        const linked = identities.find((item) => item.provider === provider);
        return [provider, { connected: Boolean(linked), email: linked?.email ?? null }];
      })),
      passkeys,
      available: methodsFor(),
    });
  });

  app.delete('/passkeys/:id', requireUser, async (c) => {
    const user = c.get('user')!;
    if ((await waysIn(user.id)) <= 1) throw new HTTPException(422, { message: 'This is your only way to sign in. Add another one first.' });
    const removed = await sql`delete from user_passkeys where id = ${c.req.param('id')} and user_id = ${user.id} returning id`;
    if (!removed.length) throw new HTTPException(404, { message: 'No such passkey.' });
    return c.json({ ok: true });
  });

  app.delete('/identities/:provider', requireUser, async (c) => {
    const provider = providerParam.safeParse(c.req.param('provider'));
    if (!provider.success) throw new HTTPException(404, { message: 'Unknown sign-in method.' });
    const user = c.get('user')!;
    if ((await waysIn(user.id)) <= 1) throw new HTTPException(422, { message: 'This is your only way to sign in. Add another one first.' });
    await sql`delete from user_identities where user_id = ${user.id} and provider = ${provider.data}`;
    return c.json({ ok: true });
  });

  return app;
}
