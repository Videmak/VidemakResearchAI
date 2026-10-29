import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireUser, type AppVariables } from '../auth.js';
import { mailReady } from '../lib/mail.js';
import { newsletterOn, setNewsletterChoice } from '../lib/newsletter.js';

/** The account page's newsletter switch. */
export function newsletterRoutes() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', requireUser);

  const state = async (userId: string) => {
    const [row] = await sql<{ newsletter_opt_out: boolean; email_verified_at: Date | null }[]>`
      select newsletter_opt_out, email_verified_at from users where id = ${userId}`;
    return {
      available: newsletterOn(),
      subscribed: !row?.newsletter_opt_out,
      // Only confirmed addresses are added; the link comes by email when email is set up.
      confirmed: Boolean(row?.email_verified_at),
      can_confirm: mailReady(),
    };
  };

  app.get('/me', async (c) => c.json(await state(c.get('user')!.id)));

  app.put('/me', async (c) => {
    const parsed = z.object({ subscribed: z.boolean() }).safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: 'Choose on or off.' });
    await setNewsletterChoice(c.get('user')!.id, parsed.data.subscribed);
    return c.json(await state(c.get('user')!.id));
  });

  return app;
}
