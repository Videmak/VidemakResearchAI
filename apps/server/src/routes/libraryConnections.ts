import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireUser, type AppVariables } from '../auth.js';
import { requireFeature } from '../lib/plans.js';
import { isImporting, runImport, startImportJob } from '../lib/libraryImport.js';
import {
  SourceError, connectZotero, connectionOf, disconnect, finishMendeley, finishZotero, mendeleyAuthorizeUrl, mendeleyConfigured,
  mendeleyFolders, mendeleyImport, mendeleyRedirectUri, zoteroAuthorizeUrl, zoteroCallbackUrl, zoteroCollections, zoteroImport,
  zoteroOAuthConfigured, type Provider,
} from '../lib/referenceManagers.js';

/** Zotero and Mendeley in the Library: connect, list collections/folders, import (in the background). */

const FEATURE = { zotero: 'zotero_import', mendeley: 'mendeley_import' } as const;
const providerParam = z.enum(['zotero', 'mendeley']);

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SourceError) throw new HTTPException(error.status as any, { message: error.message });
    throw error;
  }
}

/** A tiny page that sends the browser on (the sign-in callbacks are full-page visits). */
function goTo(c: Context, path: string) {
  const target = JSON.stringify(path).replace(/</g, '\\u003c');
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  return c.html(`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Connecting…</title><script>location.replace(${target})</script>`);
}

const withHash = (path: string, hash: string) => `${path.split('#')[0]}#${hash}`;

/** Library collection for an imported Zotero collection or Mendeley folder (one per name). */
async function folderNamed(userId: string, name: string, source: Provider) {
  const [existing] = await sql<{ id: string }[]>`select id from library_folders where user_id = ${userId} and lower(name) = lower(${name}) and parent_id is null limit 1`;
  if (existing) return existing.id;
  const [created] = await sql<{ id: string }[]>`insert into library_folders (user_id, name, source) values (${userId}, ${name.slice(0, 120)}, ${source}) returning id`;
  return created.id;
}

export function libraryConnectionRoutes() {
  const app = new Hono<{ Variables: AppVariables }>();

  // The providers send the browser back here without our sign-in header: the state identifies the person.
  app.get('/zotero/callback', async (c) => {
    const token = c.req.query('oauth_token');
    const verifier = c.req.query('oauth_verifier');
    if (!token || !verifier) return goTo(c, '/editor?tool=library#library-error=' + encodeURIComponent('Zotero sign-in was cancelled.'));
    try {
      return goTo(c, withHash(await finishZotero(token, verifier), 'library-connected=zotero'));
    } catch (error) {
      return goTo(c, '/editor?tool=library#library-error=' + encodeURIComponent((error as Error).message));
    }
  });
  app.get('/mendeley/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) return goTo(c, '/editor?tool=library#library-error=' + encodeURIComponent('Mendeley sign-in was cancelled.'));
    try {
      return goTo(c, withHash(await finishMendeley(code, state), 'library-connected=mendeley'));
    } catch (error) {
      return goTo(c, '/editor?tool=library#library-error=' + encodeURIComponent((error as Error).message));
    }
  });

  app.use('/connections/*', requireUser);
  app.use('/connections', requireUser);
  app.use('/zotero/*', requireUser);
  app.use('/mendeley/*', requireUser);

  /** Which services are connected, and how each one connects on this site. */
  app.get('/connections', async (c) => {
    const user = c.get('user')!;
    const rows = await sql<{ provider: Provider; display_name: string | null; last_import_at: Date | null }[]>`
      select provider, display_name, last_import_at from library_connections where user_id = ${user.id}`;
    const of = (provider: Provider) => rows.find((row) => row.provider === provider);
    return c.json({
      zotero: { connected: Boolean(of('zotero')), name: of('zotero')?.display_name ?? null, last_import_at: of('zotero')?.last_import_at ?? null, sign_in: zoteroOAuthConfigured(), api_key: true },
      mendeley: { connected: Boolean(of('mendeley')), name: of('mendeley')?.display_name ?? null, last_import_at: of('mendeley')?.last_import_at ?? null, sign_in: mendeleyConfigured() },
    });
  });

  app.delete('/connections/:provider', async (c) => {
    const provider = providerParam.safeParse(c.req.param('provider'));
    if (!provider.success) throw new HTTPException(404, { message: 'Unknown service.' });
    await disconnect(c.get('user')!.id, provider.data);
    return c.json({ ok: true });
  });

  /** Zotero with a pasted API key. */
  app.post('/zotero/connect', async (c) => {
    const user = c.get('user')!;
    await requireFeature(user.account_id, 'zotero_import');
    const body = z.object({ api_key: z.string().min(8).max(100) }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new HTTPException(422, { message: 'Paste your Zotero API key.' });
    return c.json(await guard(() => connectZotero(user.id, body.data.api_key)));
  });

  // Exact paths only: /:provider/… would also catch /papers/import and friends.
  const start = (provider: Provider) => async (c: Context<{ Variables: AppVariables }>) => {
    const user = c.get('user')!;
    await requireFeature(user.account_id, FEATURE[provider]);
    const next = z.string().max(500).catch('/editor?tool=library').parse((await c.req.json().catch(() => ({})))?.next);
    const url = await guard(() => (provider === 'zotero' ? zoteroAuthorizeUrl(user.id, next) : mendeleyAuthorizeUrl(user.id, next)));
    return c.json({ authorization_url: url });
  };
  app.post('/zotero/start', start('zotero'));
  app.post('/mendeley/start', start('mendeley'));

  app.get('/zotero/collections', async (c) => c.json(await guard(() => zoteroCollections(c.get('user')!.id))));
  app.get('/mendeley/folders', async (c) => c.json(await guard(() => mendeleyFolders(c.get('user')!.id))));

  const importFrom = (providerName: Provider) => async (c: Context<{ Variables: AppVariables }>) => {
    const user = c.get('user')!;
    const provider = { data: providerName };
    await requireFeature(user.account_id, FEATURE[provider.data]);
    if (isImporting(user.id)) throw new HTTPException(409, { message: 'An import is already running. It will finish in a moment.' });
    const body = z.object({
      collection: z.string().max(100).nullable().optional(),
      collection_name: z.string().max(200).nullable().optional(),
      folder_id: z.string().uuid().nullable().optional(),
      find_pdfs: z.boolean().default(true),
    }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new HTTPException(422, { message: 'Choose what to import.' });
    let folderId = body.data.folder_id ?? null;
    if (folderId) {
      const [own] = await sql`select id from library_folders where id = ${folderId} and user_id = ${user.id}`;
      if (!own) throw new HTTPException(404, { message: 'That collection was not found.' });
    } else if (body.data.collection && body.data.collection_name) {
      // A Zotero collection or Mendeley folder lands in a Library collection of the same name.
      folderId = await folderNamed(user.id, body.data.collection_name, provider.data);
    }
    const source = await guard(() => (provider.data === 'zotero' ? zoteroImport(user.id, body.data.collection ?? null) : mendeleyImport(user.id, body.data.collection ?? null)));
    const label = body.data.collection_name || (provider.data === 'zotero' ? 'your Zotero library' : 'your Mendeley library');
    const jobId = await startImportJob(user.id, provider.data, label);
    void runImport(jobId, user, source.entries, { folderId, source: provider.data, findPdfs: body.data.find_pdfs, total: source.total });
    return c.json({ job_id: jobId, total: source.total, folder_id: folderId }, 202);
  };
  app.post('/zotero/import', importFrom('zotero'));
  app.post('/mendeley/import', importFrom('mendeley'));

  /** For the admin page: the addresses to register with Zotero and Mendeley. */
  app.get('/connections/redirects', (c) => c.json({ zotero: zoteroCallbackUrl(), mendeley: mendeleyRedirectUri() }));

  return app;
}
