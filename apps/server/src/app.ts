import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { optionalUser, type AppVariables } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { signinRoutes } from './routes/signin.js';
import { documentRoutes } from './routes/documents.js';
import { assistRoutes } from './routes/assist.js';
import { wordRoutes } from './routes/word.js';
import { libraryRoutes } from './routes/library.js';
import { libraryImportRoutes } from './routes/libraryImport.js';
import { libraryConnectionRoutes } from './routes/libraryConnections.js';
import { versionRoutes } from './routes/versions.js';
import { cloudPriceRoutes, cloudRoutes } from './routes/cloud.js';
import { gatewayRoutes } from './routes/gateway.js';
import { reviewRoutes } from './routes/review.js';
import { generateRoutes } from './routes/generate.js';
import { adminRoutes } from './routes/admin.js';
import { stripeWebhookRoutes } from './routes/stripeWebhook.js';
import { billingRoutes, planRoutes } from './routes/billing.js';
import { newsletterRoutes } from './routes/newsletter.js';
import { adminAccountRoutes, adminPlanRoutes } from './routes/adminPlans.js';
import { createSlots } from './slots/index.js';
import { PlanLimitError } from './lib/plans.js';

export function createApp() {
  const slots = createSlots();
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', logger());
  app.use('/api/*', optionalUser);

  app.get('/api/health', (c) => c.json({ ok: true, llm: slots.llm.provider, papers: slots.papers.provider }));
  app.route('/api/auth', authRoutes());
  app.route('/api/auth', signinRoutes());
  app.route('/api/ai-editor/documents', versionRoutes());
  app.route('/api/ai-editor/documents', documentRoutes());
  app.route('/api/ai-editor/assist', assistRoutes(slots));
  app.route('/api/ai-editor', wordRoutes());
  app.route('/api/ai-editor', reviewRoutes(slots));
  app.route('/api/editor', generateRoutes(slots));
  app.route('/api/library', libraryConnectionRoutes());
  app.route('/api/library', libraryImportRoutes(slots));
  app.route('/api/library', libraryRoutes(slots));
  app.route('/api/cloud/prices', cloudPriceRoutes());
  app.route('/api/cloud', cloudRoutes());
  app.route('/api/admin/plans', adminPlanRoutes());
  app.route('/api/admin/accounts', adminAccountRoutes());
  app.route('/api/admin', adminRoutes(slots));
  app.route('/api/plans', planRoutes());
  app.route('/api/newsletter', newsletterRoutes());
  app.route('/api/billing', billingRoutes());
  app.route('/api/stripe', stripeWebhookRoutes());
  app.route('/v1', gatewayRoutes(slots));

  app.onError((error, c) => {
    // A plan limit says which one, so the app can offer the upgrade with that reason.
    if (error instanceof PlanLimitError) return c.json({ detail: error.message, code: 'plan_limit', limit: error.key, plan: error.plan }, 402);
    if (error instanceof HTTPException) return c.json({ detail: error.message }, error.status);
    console.error(error);
    return c.json({ detail: 'Something went wrong on our side.' }, 500);
  });
  app.notFound((c) => c.json({ detail: 'Not found' }, 404));
  return app;
}
