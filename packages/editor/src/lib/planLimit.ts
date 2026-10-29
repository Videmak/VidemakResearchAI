'use client';

import { getEditorConfig } from '../runtime';

/**
 * Plan limits (HTTP 402 from the server, e.g. "You have used today's 10 AI autocompletes on the
 * Free plan."). The last message is kept for the upgrade card; `ask` opens the host's pricing.
 */
let lastMessage: string | null = null;

export function notePlanLimit(message: string | null | undefined, ask = false) {
  if (message) lastMessage = message;
  if (ask) getEditorConfig().onUpgrade?.({ reason: 'plan_limit', message: message || undefined });
}

export function lastPlanLimit() {
  return lastMessage;
}
