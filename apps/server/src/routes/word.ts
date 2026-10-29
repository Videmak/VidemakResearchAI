import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '../env.js';
import { requireUser, type AppVariables, type AuthUser } from '../auth.js';
import { sql } from '../db.js';
import { resolveAccess, displayName, EDIT_ROLES, type DocumentRow } from '../lib/access.js';
import { documentToRead, membersOf, publicWordSettings } from '../lib/documentPayload.js';
import { blocksToText, countWords } from '../lib/blocks.js';
import { createVersion } from '../lib/versions.js';
import { recordUsage } from '../usage.js';
import { requireFeature } from '../lib/plans.js';
import { keyFromRef, openFile, readFileBytes, saveFile } from '../lib/storage.js';

const ASSET_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
const MAX_ASSET = 15 * 1024 * 1024;
const MAX_WORD = 50 * 1024 * 1024;
const ASSET_PREFIX = '/api/ai-editor/assets/';

type ConvertedAsset = { name: string; contentType: string; size: number; data: string };
type ImportResult = {
  blocks: any[]; comments: any[]; settings: Record<string, any> | null; warnings: string[]; stats: Record<string, number>; title: string;
  assets?: ConvertedAsset[]; sourceDocx?: { fileName: string; data?: string };
};

async function saveAsset(name: string, bytes: Uint8Array, contentType: string, userId: string) {
  if (!/^[a-f0-9]{32}\.[a-z]{3,4}$/.test(name)) return;
  await saveFile(`assets/${name}`, bytes, contentType);
  await sql`insert into assets (id, user_id, content_type, size) values (${name}, ${userId}, ${contentType}, ${bytes.byteLength}) on conflict (id) do nothing`;
}

async function converterError(response: Response, fallback: string): Promise<never> {
  const body: any = await response.json().catch(() => null);
  const status = [400, 413, 415, 422].includes(response.status) ? response.status : response.status === 504 ? 504 : 502;
  throw new HTTPException(status as any, { message: (body && typeof body.detail === 'string' && body.detail) || fallback });
}

/** Forwards a multipart body to the converter as is (docx → PDF). */
async function forward(c: Context, target: string) {
  const headers: Record<string, string> = {};
  const type = c.req.header('content-type');
  if (type) headers['content-type'] = type;
  // Node's fetch needs duplex: 'half' to stream a request body.
  const response = await fetch(`${env.convertUrl}${target}`, { method: 'POST', headers, body: c.req.raw.body, duplex: 'half', signal: AbortSignal.timeout(600_000) } as RequestInit & { duplex: 'half' }).catch(() => null);
  if (!response) throw new HTTPException(503, { message: 'The document converter is not available right now.' });
  if (!response.ok) return converterError(response, 'The file could not be converted.');
  const out = new Headers();
  for (const name of ['content-type', 'content-disposition', 'content-length']) {
    const value = response.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(response.body, { status: 200, headers: out });
}

const exportBody = z.object({
  document_id: z.string().max(64).optional(),
  title: z.string().max(500).default('Untitled document'),
  blocks: z.array(z.any()).max(20_000),
  comments: z.array(z.any()).optional(),
  settings: z.record(z.any()).nullable().optional(),
  format: z.enum(['docx', 'pdf', 'latex']).default('docx'),
});

export function wordRoutes() {
  const app = new Hono<{ Variables: AppVariables }>();

  /** Opens a Word file as a new document, or replaces an open document's content with it. */
  app.post('/word/import', requireUser, async (c) => {
    const user = c.get('user')!;
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw new HTTPException(422, { message: 'Choose a Word file.' });
    if (file.size > MAX_WORD) throw new HTTPException(413, { message: 'Word files can be up to 50 MB.' });
    const documentId = typeof form?.get('document_id') === 'string' && form?.get('document_id') ? String(form.get('document_id')) : null;
    let existing: DocumentRow | null = null;
    if (documentId) {
      const access = await resolveAccess(documentId, user);
      if (!EDIT_ROLES.includes(access.role)) throw new HTTPException(403, { message: 'Only editors can replace this document.' });
      existing = access.document;
    }

    const outgoing = new FormData();
    outgoing.append('file', file, file.name);
    outgoing.append('asset_url_prefix', ASSET_PREFIX);
    outgoing.append('include_source', 'true');
    const response = await fetch(`${env.convertUrl}/word/import`, { method: 'POST', body: outgoing, signal: AbortSignal.timeout(600_000) }).catch(() => null);
    if (!response) throw new HTTPException(503, { message: 'The document converter is not available right now.' });
    if (!response.ok) await converterError(response, 'This file could not be opened.');
    const result = (await response.json()) as ImportResult;

    for (const asset of result.assets ?? []) {
      const bytes = Buffer.from(asset.data, 'base64');
      if (bytes.byteLength <= MAX_ASSET) await saveAsset(asset.name, bytes, asset.contentType, user.id).catch((error) => console.error(`word import: image ${asset.name} not saved: ${(error as Error).message}`));
    }

    const targetId = existing?.id ?? randomUUID();
    let source: Record<string, unknown> | undefined;
    if (result.sourceDocx?.data) {
      // Kept as the template for Word export; a store outage only loses that, not the import.
      const key = `word-source/${targetId}/${Date.now()}.docx`;
      const saved = await saveFile(key, Buffer.from(result.sourceDocx.data, 'base64'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .then(() => true, (error) => { console.error(`word import: source not saved: ${(error as Error).message}`); return false; });
      if (saved) source = { fileName: file.name.slice(0, 200), importedAt: Date.now(), key };
    }
    const settings = { ...(result.settings || {}), ...(source ? { source } : {}) };
    const title = (result.title || file.name.replace(/\.[^.]+$/, '') || 'Untitled document').slice(0, 500);
    const activity = { id: `${Date.now()}`, actorSessionId: `user-${user.id}`, actorDisplayName: displayName(user), timestamp: Date.now() };

    let document: DocumentRow;
    if (!existing) {
      const text = blocksToText(result.blocks);
      [document] = await sql<DocumentRow[]>`
        insert into documents (id, owner_user_id, title, blocks, comments, share_settings, activity, word_settings, word_count, search)
        values (${targetId}, ${user.id}, ${title}, ${sql.json(result.blocks)}, ${sql.json(result.comments || [])},
                ${sql.json({ isLinkSharingEnabled: false, defaultAccessRole: 'editor', updatedAt: Date.now() })},
                ${sql.json([{ ...activity, action: 'document_created', description: `Opened ${file.name.slice(0, 120)}` }])},
                ${sql.json(settings as any)}, ${countWords(text)}, to_tsvector('simple', ${title + '\n' + text.slice(0, 200_000)}))
        returning *`;
    } else {
      // The browser replaces the blocks itself (they sync through the live document).
      [document] = await sql<DocumentRow[]>`
        update documents set word_settings = ${sql.json(settings as any)}, comments = ${sql.json(result.comments || [])},
          activity = ${sql.json([{ ...activity, action: 'content_updated', description: `Replaced the content with ${file.name.slice(0, 120)}` }, ...(existing.activity || [])].slice(0, 40) as any)},
          updated_at = now()
        where id = ${existing.id} returning *`;
    }
    await createVersion({ ...document, blocks: result.blocks }, user, 'import', `Imported ${file.name}`.slice(0, 120)).catch(() => undefined);
    return c.json({
      document: documentToRead(document, await membersOf(document.id), existing ? (await resolveAccess(document.id, user)).role : 'owner'),
      blocks: result.blocks,
      comments: result.comments || [],
      settings: publicWordSettings(document.word_settings),
      warnings: result.warnings || [],
      stats: result.stats || {},
      title,
    });
  });

  /** The document as .docx (original Word file as template), PDF, or a LaTeX project. */
  app.post('/word/export', requireUser, async (c) => {
    const user: AuthUser = c.get('user')!;
    const parsed = exportBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: 'Nothing to export.' });
    const body = parsed.data;
    if (body.format === 'latex') await requireFeature(user.account_id, 'latex_export');
    let settings: Record<string, any> = { ...(body.settings || {}) };
    delete settings.source;
    let template: Buffer | null = null;
    if (body.document_id) {
      const { document } = await resolveAccess(body.document_id, user);
      const stored = document.word_settings || {};
      settings = { ...stored, ...settings };
      delete settings.source;
      // Older imports kept the absolute path on this server instead of a key.
      const sourceKey = keyFromRef(stored.source?.key ?? stored.source?.path);
      if (sourceKey?.startsWith('word-source/') && body.format !== 'latex') {
        template = await readFileBytes(sourceKey).catch(() => null);
      }
    }
    const form = new FormData();
    form.append('payload', JSON.stringify({
      title: body.title, blocks: body.blocks, comments: body.comments || [], settings, format: body.format,
      author: displayName(user), asset_url_prefix: ASSET_PREFIX, asset_fetch_base: `${env.internalUrl}${ASSET_PREFIX}`,
    }));
    if (template) form.append('source', new Blob([template], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'template.docx');
    const response = await fetch(`${env.convertUrl}/word/export`, { method: 'POST', body: form, signal: AbortSignal.timeout(600_000) }).catch(() => null);
    if (!response) throw new HTTPException(503, { message: 'The document converter is not available right now.' });
    if (!response.ok) await converterError(response, 'The document could not be exported.');
    await recordUsage({ accountId: user.account_id, service: 'conversions', quantity: 1, requestId: randomUUID(), metadata: { format: body.format } });
    const out = new Headers();
    for (const name of ['content-type', 'content-disposition', 'content-length']) {
      const value = response.headers.get(name);
      if (value) out.set(name, value);
    }
    return new Response(response.body, { status: 200, headers: out });
  });

  app.post('/documents/convert/docx-to-pdf', requireUser, (c) => forward(c, '/convert/docx-to-pdf'));

  /** Images pasted or imported into documents, stored once by content hash. */
  app.post('/assets', requireUser, async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw new HTTPException(422, { message: 'Choose an image.' });
    if (file.size > MAX_ASSET) throw new HTTPException(413, { message: 'Images can be up to 15 MB.' });
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const contentType = ASSET_TYPES[ext] || (Object.values(ASSET_TYPES).includes(file.type) ? file.type : '');
    if (!contentType) throw new HTTPException(415, { message: 'Use a PNG, JPEG, GIF, WebP or SVG image.' });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = Object.keys(ASSET_TYPES).find((key) => ASSET_TYPES[key] === contentType) || 'bin';
    const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${extension}`;
    await saveAsset(name, bytes, contentType, c.get('user')!.id).catch((error) => {
      console.error(`asset upload: ${(error as Error).message}`);
      throw new HTTPException(503, { message: 'The image could not be saved right now. Try again in a minute.' });
    });
    return c.json({ name, url: `${ASSET_PREFIX}${name}`, contentType, size: bytes.byteLength });
  });

  app.get('/assets/:name', async (c) => {
    const name = c.req.param('name');
    if (!/^[a-f0-9]{32}\.[a-z]{3,4}$/.test(name)) throw new HTTPException(404, { message: 'Not found' });
    const file = await openFile(`assets/${name}`);
    if (!file) throw new HTTPException(404, { message: 'Not found' });
    const ext = name.split('.').pop()!;
    c.header('Content-Type', ASSET_TYPES[ext] || 'application/octet-stream');
    if (file.size !== null) c.header('Content-Length', String(file.size));
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    c.header('X-Content-Type-Options', 'nosniff');
    if (ext === 'svg') c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    return c.body(file.body);
  });

  return app;
}
