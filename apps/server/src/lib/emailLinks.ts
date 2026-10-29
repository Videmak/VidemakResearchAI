import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../env.js';
import { sql } from '../db.js';
import { confirmEmail, passwordResetEmail } from './emails.js';
import { mailReady, sendMail } from './mail.js';
import { settings } from './settings.js';

/**
 * Links sent by email: reset a password (one hour, dead once the password changes) and
 * confirm an email address (seven days). Signed with their own key, so they never work as a
 * sign-in token.
 */

type Purpose = 'reset' | 'verify';
const key = createHash('sha256').update(`videmak-email-links:${env.jwtSecret}`).digest();

/** Changes whenever the password does, which retires reset links already sent. */
export const passwordStamp = (passwordHash: string | null) => createHash('sha256').update(passwordHash ?? 'no-password').digest('base64url').slice(0, 16);

export async function linkToken(purpose: Purpose, userId: string, claims: Record<string, string>, ttl: string) {
  return new SignJWT({ ...claims, purpose }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setExpirationTime(ttl).sign(key);
}

export async function readLinkToken(token: string, purpose: Purpose): Promise<(JWTPayload & Record<string, unknown>) | null> {
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    return payload.purpose === purpose && payload.sub ? payload : null;
  } catch {
    return null;
  }
}

const appUrl = (path: string) => `${settings().publicUrl.replace(/\/+$/, '')}${path}`;

export async function sendPasswordReset(user: { id: string; email: string; password_hash: string | null }) {
  const token = await linkToken('reset', user.id, { stamp: passwordStamp(user.password_hash) }, '1h');
  await sendMail(passwordResetEmail(user.email, appUrl(`/reset-password#token=${token}`)));
}

export async function sendEmailConfirmation(user: { id: string; email: string }) {
  const token = await linkToken('verify', user.id, { email: user.email.toLowerCase() }, '7d');
  await sendMail(confirmEmail(user.email, appUrl(`/confirm-email#token=${token}`)));
}

/** After a password sign-up: asks the person to confirm their address (nothing if email is off). */
export function confirmAfterSignUp(user: { id: string; email: string }) {
  if (!mailReady()) return;
  void sendEmailConfirmation(user).catch((error) => console.error(`confirmation email to user ${user.id} failed: ${(error as Error).message}`));
}

/** Marks the address confirmed; true when the link matched the account's current email. */
export async function confirmEmailAddress(token: string) {
  const payload = await readLinkToken(token, 'verify');
  if (!payload) return null;
  const [row] = await sql<{ id: string; email: string }[]>`
    update users set email_verified_at = coalesce(email_verified_at, now())
    where id = ${payload.sub!} and lower(email) = ${String(payload.email)} and disabled_at is null
    returning id, email`;
  return row ?? null;
}
