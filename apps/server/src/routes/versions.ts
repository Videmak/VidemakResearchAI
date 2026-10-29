import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireUser, type AppVariables } from '../auth.js';
import { resolveAccess, EDIT_ROLES, type DocumentRow } from '../lib/access.js';
import { createVersion, versionSummary, type VersionRow } from '../lib/versions.js';
import { blocksToText, countWords } from '../lib/blocks.js';
import { broadcastDocument } from '../realtime.js';

const cleanLabel = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : null);

export function versionRoutes() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('/:id/versions', requireUser);
  app.use('/:id/versions/*', requireUser);

  app.get('/:id/versions', async (c) => {
    const { document } = await resolveAccess(c.req.param('id'), c.get('user'));
    const rows = await sql<VersionRow[]>`
      select id, created_at, author_name, reason, label, title, word_count, block_count
      from document_versions where document_id = ${document.id} order by created_at desc limit 200`;
    return c.json({ versions: rows.map(versionSummary) });
  });

  app.post('/:id/versions', async (c) => {
    const user = c.get('user')!;
    const { document, role } = await resolveAccess(c.req.param('id'), user);
    if (!EDIT_ROLES.includes(role)) throw new HTTPException(403, { message: 'Only editors can save versions' });
    const body = await c.req.json().catch(() => ({}));
    // reason "ai": the writer accepted AI-written text (shown as Videmak AI in the history).
    const reason = body?.reason === 'ai' ? 'ai' : 'manual';
    return c.json(versionSummary(await createVersion(document, user, reason, cleanLabel(body?.label))));
  });

  app.get('/:id/versions/:versionId', async (c) => {
    const { document } = await resolveAccess(c.req.param('id'), c.get('user'));
    const [version] = await sql<(VersionRow & { blocks: unknown[]; word_settings: unknown })[]>`
      select * from document_versions where id = ${c.req.param('versionId')} and document_id = ${document.id}`;
    if (!version) throw new HTTPException(404, { message: 'Version not found' });
    return c.json({ ...versionSummary(version), blocks: version.blocks, wordSettings: version.word_settings ?? null });
  });

  app.patch('/:id/versions/:versionId', async (c) => {
    const { document, role } = await resolveAccess(c.req.param('id'), c.get('user'));
    if (!EDIT_ROLES.includes(role)) throw new HTTPException(403, { message: 'Only editors can rename versions' });
    const parsed = z.object({ label: z.string().max(120).nullable() }).safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: 'Invalid name.' });
    const [version] = await sql<VersionRow[]>`
      update document_versions set label = ${cleanLabel(parsed.data.label)} where id = ${c.req.param('versionId')} and document_id = ${document.id}
      returning id, created_at, author_name, reason, label, title, word_count, block_count`;
    if (!version) throw new HTTPException(404, { message: 'Version not found' });
    return c.json(versionSummary(version));
  });

  app.post('/:id/versions/:versionId/restore', async (c) => {
    const user = c.get('user')!;
    const { document, role } = await resolveAccess(c.req.param('id'), user);
    if (!EDIT_ROLES.includes(role)) throw new HTTPException(403, { message: 'Only editors can restore versions' });
    const [version] = await sql<(VersionRow & { blocks: unknown[]; word_settings: Record<string, any> | null })[]>`
      select * from document_versions where id = ${c.req.param('versionId')} and document_id = ${document.id}`;
    if (!version) throw new HTTPException(404, { message: 'Version not found' });
    await createVersion(document, user, 'before-restore');
    const text = blocksToText(version.blocks);
    const [restored] = await sql<DocumentRow[]>`
      update documents set title = ${version.title || document.title}, blocks = ${sql.json(version.blocks as any)},
        word_settings = ${version.word_settings ? sql.json(version.word_settings) : sql`word_settings`},
        word_count = ${countWords(text)}, updated_at = now()
      where id = ${document.id} returning *`;
    // The browser applies the restored blocks to the live (Yjs) document itself, which syncs to everyone.
    const saved = await createVersion(restored, user, 'restore');
    broadcastDocument(document.id, null);
    return c.json({ ...versionSummary(saved), blocks: restored.blocks, wordSettings: restored.word_settings ?? null });
  });

  return app;
}
