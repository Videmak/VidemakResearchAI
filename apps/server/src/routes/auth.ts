import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { sql } from '../db.js';
import { env } from '../env.js';
import { hashPassword, isImportedHash, verifyPassword, signSession, requireUser, type AppVariables, type AuthUser } from '../auth.js';
import { rateLimit } from '../lib/rateLimit.js';
import { methodsFor } from '../lib/signin.js';
import { createUser, publicUser, signedIn, syncAdmin } from '../lib/users.js';
import { requireHuman } from '../lib/turnstile.js';
import { mailReady } from '../lib/mail.js';
import { confirmAfterSignUp, confirmEmailAddress, passwordStamp, readLinkToken, sendEmailConfirmation, sendPasswordReset } from '../lib/emailLinks.js';
import { queueNewsletterSync } from '../lib/newsletter.js';

const registerBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, 'Use at least 8 characters for your password.').max(200),
  full_name: z.string().trim().max(120).optional().default(''),
});
const loginBody = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });
const resetBody = z.object({ token: z.string().min(20).max(2000), password: registerBody.shape.password });

/** Email and password can be switched off in Admin › Sign-in (when a provider can sign people up). */
function passwordOn() {
  if (!methodsFor().password) throw new HTTPException(403, { message: 'Email and password sign-in is turned off. Use one of the other ways to sign in.' });
}

export function authRoutes() {
  const app = new Hono<{ Variables: AppVariables }>();

  app.post('/register', rateLimit({ key: 'register', limit: 10, windowSeconds: 3600 }), async (c) => {
    passwordOn();
    const body = await c.req.json().catch(() => ({}));
    const parsed = registerBody.safeParse(body);
    if (!parsed.success) throw new HTTPException(422, { message: parsed.error.issues[0]?.message || 'Check the form and try again.' });
    await requireHuman(c, body?.turnstile_token);
    const { email, password, full_name } = parsed.data;
    const [existing] = await sql`select 1 from users where email = ${email}`;
    if (existing) throw new HTTPException(409, { message: 'An account with this email already exists. Sign in instead.' });
    const created = await createUser({ email, fullName: full_name || null, passwordHash: await hashPassword(password) });
    confirmAfterSignUp(created);
    const user = await signedIn(created);
    return c.json({ token: await signSession(user), user: await publicUser(user) }, 201);
  });

  app.post('/login', rateLimit({ key: 'login', limit: 20, windowSeconds: 900 }), async (c) => {
    passwordOn();
    const body = await c.req.json().catch(() => ({}));
    const parsed = loginBody.safeParse(body);
    if (!parsed.success) throw new HTTPException(422, { message: 'Enter your email and password.' });
    await requireHuman(c, body?.turnstile_token);
    const [row] = await sql<(AuthUser & { password_hash: string | null; disabled_at: Date | null; legacy_id: string | null; legacy_reset_sent_at: Date | null })[]>`
      select id, email, full_name, account_id, is_admin, password_hash, disabled_at, legacy_id, legacy_reset_sent_at from users where email = ${parsed.data.email}`;
    const ok = row?.password_hash && !row.disabled_at && (await verifyPassword(row.password_hash, parsed.data.password));
    if (row && !ok && !row.disabled_at && row.legacy_id && mailReady() && (!row.password_hash || isImportedHash(row.password_hash))) {
      // Moved from the previous app and the old password did not work: send a link to set a new one (once an hour).
      const recent = row.legacy_reset_sent_at && Date.now() - row.legacy_reset_sent_at.getTime() < 3600_000;
      if (!recent) {
        await sql`update users set legacy_reset_sent_at = now() where id = ${row.id}`;
        await sendPasswordReset(row).catch((error) => console.error(`legacy reset email to user ${row.id} failed: ${(error as Error).message}`));
      }
      throw new HTTPException(401, { message: `Videmak has moved to a new app. We emailed ${row.email} a link to set your password.` });
    }
    if (!row || !ok) throw new HTTPException(401, { message: 'That email and password do not match.' });
    // An imported account's old password works once more and is stored the new way from now on.
    if (isImportedHash(row.password_hash!)) await sql`update users set password_hash = ${await hashPassword(parsed.data.password)} where id = ${row.id}`;
    const user = await signedIn({ id: row.id, email: row.email, full_name: row.full_name, account_id: row.account_id, is_admin: row.is_admin });
    return c.json({ token: await signSession(user), user: await publicUser(user) });
  });

  /** Emails a reset link. Always answers the same way, so it never tells whether an account exists. */
  app.post('/password/forgot', rateLimit({ key: 'forgot', limit: 5, windowSeconds: 900 }), async (c) => {
    passwordOn();
    if (!mailReady()) throw new HTTPException(503, { message: 'Password reset by email is not available here yet.' });
    const body = await c.req.json().catch(() => ({}));
    const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).safeParse(body);
    if (!parsed.success) throw new HTTPException(422, { message: 'Enter your email address.' });
    await requireHuman(c, body?.turnstile_token);
    const [row] = await sql<{ id: string; email: string; password_hash: string | null }[]>`
      select id, email, password_hash from users where email = ${parsed.data.email} and disabled_at is null`;
    if (row) await sendPasswordReset(row).catch((error) => console.error(`password reset email to user ${row.id} failed: ${(error as Error).message}`));
    return c.json({ ok: true });
  });

  /** Sets a new password from an emailed link, confirms the address and signs the person in. */
  app.post('/password/reset', rateLimit({ key: 'reset', limit: 10, windowSeconds: 900 }), async (c) => {
    passwordOn();
    const parsed = resetBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: parsed.error.issues.find((issue) => issue.path[0] === 'password')?.message || 'This link is not valid.' });
    const payload = await readLinkToken(parsed.data.token, 'reset');
    const [row] = payload ? await sql<(AuthUser & { password_hash: string | null })[]>`
      select id, email, full_name, account_id, is_admin, password_hash from users where id = ${payload.sub!} and disabled_at is null` : [];
    if (!row || payload?.stamp !== passwordStamp(row.password_hash)) {
      throw new HTTPException(410, { message: 'This link has expired or was already used. Ask for a new one.' });
    }
    await sql`update users set password_hash = ${await hashPassword(parsed.data.password)}, email_verified_at = coalesce(email_verified_at, now()) where id = ${row.id}`;
    queueNewsletterSync();
    const user = await signedIn({ id: row.id, email: row.email, full_name: row.full_name, account_id: row.account_id, is_admin: row.is_admin });
    return c.json({ token: await signSession(user), user: await publicUser(user) });
  });

  /** Confirms an email address from the emailed link. */
  app.post('/email/confirm', rateLimit({ key: 'confirm', limit: 20, windowSeconds: 900 }), async (c) => {
    const parsed = z.object({ token: z.string().min(20).max(2000) }).safeParse(await c.req.json().catch(() => ({})));
    const confirmed = parsed.success ? await confirmEmailAddress(parsed.data.token) : null;
    if (!confirmed) throw new HTTPException(410, { message: 'This link has expired. Sign in and ask for a new one from your account.' });
    queueNewsletterSync();
    return c.json({ ok: true, email: confirmed.email });
  });

  /** Sends the confirmation link again (account page). */
  app.post('/email/confirm/send', requireUser, rateLimit({ key: 'confirm-send', limit: 3, windowSeconds: 3600 }), async (c) => {
    if (!mailReady()) throw new HTTPException(503, { message: 'Email is not set up yet.' });
    const user = c.get('user')!;
    const [row] = await sql<{ email_verified_at: Date | null }[]>`select email_verified_at from users where id = ${user.id}`;
    if (row?.email_verified_at) return c.json({ ok: true, confirmed: true });
    await sendEmailConfirmation(user).catch((error) => {
      console.error(`confirmation email to user ${user.id} failed: ${(error as Error).message}`);
      throw new HTTPException(502, { message: 'The email could not be sent right now. Try again later.' });
    });
    return c.json({ ok: true, confirmed: false });
  });

  app.get('/me', requireUser, async (c) => c.json(await publicUser(await syncAdmin(c.get('user')!))));

  /** People moved from the previous app: their old work is archived and can be requested by email. */
  app.get('/me/archive', requireUser, async (c) => {
    const [row] = await sql<{ legacy_id: string | null }[]>`select legacy_id from users where id = ${c.get('user')!.id}`;
    return c.json({ archived: Boolean(row?.legacy_id), request_email: env.supportEmail || null });
  });

  return app;
}
