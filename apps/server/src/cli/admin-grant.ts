/**
 * Makes an existing person an admin from the server's shell, for installs without email set up
 * (where ADMIN_EMAILS cannot confirm the address):
 *   docker compose exec server node dist/cli/admin-grant.js you@example.com
 */
import { sql } from '../db.js';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email.includes('@')) {
  console.error('Usage: node dist/cli/admin-grant.js you@example.com');
  process.exit(1);
}
const [user] = await sql`update users set is_admin = true, email_verified_at = coalesce(email_verified_at, now()) where lower(email) = ${email} returning id`;
console.log(user ? `${email} is now an admin.` : `No account with ${email}. Sign up first, then run this again.`);
await sql.end();
process.exit(user ? 0 : 1);
