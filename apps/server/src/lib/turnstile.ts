import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { settings, type EffectiveSettings } from './settings.js';

/**
 * Cloudflare Turnstile on the sign-in form. Off until it is switched on AND both keys are saved
 * (Admin › Sign-in); then email lookup, sign-in and sign-up each need a fresh token. A check
 * that cannot be completed (Cloudflare unreachable) refuses rather than lets through.
 */
export function turnstileSiteKey(s: EffectiveSettings = settings()): string | null {
  const on = (s.signinTurnstile ?? '').trim().toLowerCase() === 'on';
  return on && s.turnstileSiteKey && s.turnstileSecretKey ? s.turnstileSiteKey : null;
}

const clientAddress = (c: Context) => c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || '';

export async function requireHuman(c: Context, token: unknown) {
  const s = settings();
  if (!turnstileSiteKey(s)) return;
  if (typeof token !== 'string' || !token || token.length > 4096) throw new HTTPException(422, { message: 'Complete the security check, then try again.' });
  const form = new URLSearchParams({ secret: s.turnstileSecretKey, response: token });
  const address = clientAddress(c);
  if (address) form.set('remoteip', address);
  let ok = false;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form, signal: AbortSignal.timeout(10_000) });
    const result = (await response.json().catch(() => null)) as { success?: boolean; 'error-codes'?: string[] } | null;
    ok = response.ok && Boolean(result?.success);
    if (!ok) console.warn('turnstile refused', response.status, result?.['error-codes']);
  } catch (error) {
    console.warn('turnstile check failed', (error as Error).message);
  }
  if (!ok) throw new HTTPException(422, { message: 'The security check failed. Try again.' });
}
