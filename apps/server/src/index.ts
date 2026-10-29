import { serve } from '@hono/node-server';
import type { Server as HttpServer } from 'node:http';
import { createApp } from './app.js';
import { migrate } from './db.js';
import { env } from './env.js';
import { handleCollabUpgrade } from './collab.js';
import { handleRealtimeUpgrade } from './realtime.js';
import { loadSettings } from './lib/settings.js';
import { seedPlans } from './lib/plans.js';
import { startNewsletterSync } from './lib/newsletter.js';

await migrate();
await loadSettings();
if (await seedPlans()) console.log('default plans created');
startNewsletterSync();
const app = createApp();
const server = serve({ fetch: app.fetch, port: env.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`videmak server listening on :${info.port}`);
}) as HttpServer;

server.on('upgrade', (request, socket, head) => {
  if (handleCollabUpgrade(request, socket, head)) return;
  if (handleRealtimeUpgrade(request, socket, head)) return;
  socket.destroy();
});

const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
