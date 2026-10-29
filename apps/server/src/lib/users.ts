import { sql } from '../db.js';
import { env } from '../env.js';
import type { AuthUser } from '../auth.js';
import { effectivePlan } from './plans.js';
import { queueNewsletterSync } from './newsletter.js';

/** Creating people and what the browser is told about them (shared by every sign-in method). */

export type PublicUser = { id: string; email: string; full_name: string | null; plan: string; plan_name: string; is_admin: boolean };

/** The plan shown is the one in force (a lapsed subscription shows the free plan). */
export async function publicUser(user: AuthUser): Promise<PublicUser> {
  const { plan } = await effectivePlan(user.account_id);
  return {
    id: user.id, email: user.email, full_name: user.full_name,
    plan: plan?.id ?? 'free', plan_name: plan?.name ?? 'Free', is_admin: Boolean(user.is_admin),
  };
}

/**
 * People listed in ADMIN_EMAILS become admins once their email is confirmed (by the confirmation
 * link or by Google, Microsoft or Apple). Without that check, anyone could sign up with the
 * admin's address first. Installs without email use `node dist/cli/admin-grant.js <email>` instead.
 */
export async function syncAdmin(user: AuthUser): Promise<AuthUser> {
  if (user.is_admin || !env.adminEmails.includes(user.email.toLowerCase())) return user;
  const [promoted] = await sql`update users set is_admin = true where id = ${user.id} and email_verified_at is not null returning id`;
  return { ...user, is_admin: Boolean(promoted) };
}

/** Attaches document invitations sent to this email before the person had an account. */
export async function claimInvitations(user: AuthUser) {
  await sql`update document_members set user_id = ${user.id}, status = 'active' where lower(invite_email) = ${user.email} and user_id is null`;
}

/** A new person with their own account (on the default plan). No password for provider sign-ups. */
export async function createUser(input: { email: string; fullName: string | null; passwordHash: string | null; emailVerified?: boolean }): Promise<AuthUser> {
  // Addresses confirmed by Google, Microsoft or Apple join the newsletter list at once.
  if (input.emailVerified) queueNewsletterSync();
  return sql.begin(async (tx) => {
    const [account] = await tx<{ id: string }[]>`insert into accounts (name) values (${input.fullName || input.email}) returning id`;
    const [created] = await tx<AuthUser[]>`
      insert into users (account_id, email, full_name, password_hash, email_verified_at)
      values (${account.id}, ${input.email}, ${input.fullName || null}, ${input.passwordHash}, ${input.emailVerified ? new Date() : null})
      returning id, email, full_name, account_id, is_admin`;
    return created;
  });
}

/** Everything that happens on every successful sign-in, whatever the method. */
export async function signedIn(user: AuthUser): Promise<AuthUser> {
  const admin = await syncAdmin(user);
  await sql`update users set last_seen_at = now() where id = ${user.id}`;
  await claimInvitations(admin);
  return admin;
}

export async function activeUser(id: string): Promise<AuthUser | null> {
  const [row] = await sql<AuthUser[]>`select id, email, full_name, account_id, is_admin from users where id = ${id} and disabled_at is null`;
  return row ?? null;
}
