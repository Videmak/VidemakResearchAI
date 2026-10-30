import { hash, verify } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { env } from './env.js';
import { sql } from './db.js';

export type AuthUser = { id: string; email: string; full_name: string | null; account_id: string; is_admin: boolean };
export type AppVariables = { user: AuthUser | null };

const secret = new TextEncoder().encode(env.jwtSecret);

export const hashPassword = (password: string) => hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
/** Bcrypt hashes come from accounts imported from another app (Laravel writes `$2y$`). */
export const isImportedHash = (hashed: string) => /^\$2[aby]\$\d{2}\$/.test(hashed);

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  if (isImportedHash(hashed)) return bcrypt.compare(password, hashed.replace(/^\$2y\$/, '$2b$')).catch(() => false);
  return verify(hashed, password).catch(() => false);
}

export async function signSession(user: Pick<AuthUser, 'id' | 'email'>, ttl = '30d') {
  return new SignJWT({ email: user.email }).setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setIssuedAt().setExpirationTime(ttl).sign(secret);
}

export async function userFromToken(token: string | null | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (!payload.sub) return null;
    const [row] = await sql<AuthUser[]>`select id, email, full_name, account_id, is_admin from users where id = ${payload.sub} and disabled_at is null`;
    return row ?? null;
  } catch {
    return null;
  }
}

export function bearer(c: Context): string | null {
  const header = c.req.header('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return c.req.query('token') || null;
}

/** Sets c.var.user when a valid session token is present; never rejects. */
export const optionalUser: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  c.set('user', await userFromToken(bearer(c)));
  await next();
};

/** Rejects with 401 unless a valid session token is present. */
export const requireUser: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const user = c.get('user') ?? (await userFromToken(bearer(c)));
  if (!user) throw new HTTPException(401, { message: 'Sign in to continue.' });
  c.set('user', user);
  await next();
};

/** Rejects with 403 unless the signed-in person is an admin. */
export const requireAdmin: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const user = c.get('user') ?? (await userFromToken(bearer(c)));
  if (!user) throw new HTTPException(401, { message: 'Sign in to continue.' });
  if (!user.is_admin) throw new HTTPException(403, { message: 'Admins only.' });
  c.set('user', user);
  await next();
};
