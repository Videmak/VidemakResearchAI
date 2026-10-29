import { sql } from './db.js';
import type { ServiceName } from './lib/prices.js';

/** One service call made from the app itself (plans cover these; Cloud keys are charged in lib/credits.ts). */
export type UsageEvent = {
  accountId: string;
  apiKeyId?: string | null;
  service: ServiceName;
  quantity: number;
  requestId: string;
  metadata?: Record<string, unknown>;
};

/** Append-only; the request id makes retries idempotent (never billed twice). */
export async function recordUsage(event: UsageEvent) {
  if (!event.quantity || event.quantity <= 0) return;
  await sql`
    insert into usage_events (account_id, api_key_id, service, quantity, request_id, metadata)
    values (${event.accountId}, ${event.apiKeyId ?? null}, ${event.service}, ${event.quantity}, ${event.requestId}, ${sql.json((event.metadata ?? {}) as any)})
    on conflict (request_id, service) do nothing`;
}
