import postgres from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { env } from './env.js';

export const sql = postgres(env.databaseUrl, { max: 20, idle_timeout: 30, transform: { undefined: null } });

/** Applies migrations/NNN_*.sql in order, once each. */
export async function migrate() {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const applied = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((row) => row.name));
  for (const file of files) {
    if (applied.has(file)) continue;
    const text = await readFile(path.join(dir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    console.log(`migration applied: ${file}`);
  }
}
