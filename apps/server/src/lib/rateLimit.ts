import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

/** Small fixed-window limiter per client address (one server process; Valkey-backed later). */
const windows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(options: { key: string; limit: number; windowSeconds: number }): MiddlewareHandler {
  return async (c, next) => {
    const address = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
    const id = `${options.key}:${address}`;
    const now = Date.now();
    const current = windows.get(id);
    if (!current || current.resetAt < now) windows.set(id, { count: 1, resetAt: now + options.windowSeconds * 1000 });
    else if (++current.count > options.limit) throw new HTTPException(429, { message: 'Too many attempts. Try again in a few minutes.' });
    if (windows.size > 50_000) windows.clear();
    await next();
  };
}
