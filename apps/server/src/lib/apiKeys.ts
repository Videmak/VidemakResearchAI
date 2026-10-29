import { createHash, randomBytes } from 'node:crypto';
import { sql } from '../db.js';

export type ApiKeyRow = { id: string; account_id: string; name: string; prefix: string; mode: 'test' | 'live'; monthly_credit_cap: number | null; allowed_services: string[] | null; revoked_at: Date | null };

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** Creates a key; the full key is returned once and only its hash is stored. */
export async function createApiKey(accountId: string, name: string, mode: 'test' | 'live') {
  const secret = randomBytes(24).toString('base64url');
  const key = `vm_${mode}_${secret}`;
  const [row] = await sql<ApiKeyRow[]>`
    insert into api_keys (account_id, name, prefix, key_hash, mode)
    values (${accountId}, ${name}, ${key.slice(0, 12)}, ${hashKey(key)}, ${mode})
    returning id, account_id, name, prefix, mode, monthly_credit_cap, allowed_services, revoked_at`;
  return { key, row };
}

const cache = new Map<string, { row: ApiKeyRow | null; at: number }>();

export async function findApiKey(key: string): Promise<ApiKeyRow | null> {
  if (!/^vm_(test|live)_[A-Za-z0-9_-]{20,}$/.test(key)) return null;
  const hashed = hashKey(key);
  const cached = cache.get(hashed);
  if (cached && Date.now() - cached.at < 30_000) return cached.row;
  const [row] = await sql<ApiKeyRow[]>`
    select id, account_id, name, prefix, mode, monthly_credit_cap, allowed_services, revoked_at from api_keys where key_hash = ${hashed}`;
  const result = row && !row.revoked_at ? row : null;
  cache.set(hashed, { row: result, at: Date.now() });
  if (result) void sql`update api_keys set last_used_at = now() where id = ${result.id}`.catch(() => undefined);
  return result;
}

/** Forget cached lookups (after a key is revoked or its cap changes). */
export function forgetApiKeys() {
  cache.clear();
}
