import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireUser, type AppVariables, type AuthUser } from '../auth.js';
import { resolveAccess, displayName, EDIT_ROLES, COMMENT_ROLES, type DocumentRow, type Role } from '../lib/access.js';
import { documentToRead, membersOf, memberToDict, type MemberRow } from '../lib/documentPayload.js';
import { blocksToText, countWords } from '../lib/blocks.js';
import { maybeAutoVersion } from '../lib/versions.js';
import { broadcastDocument } from '../realtime.js';
import { env } from '../env.js';

const ms = (value: Date | string | null | undefined) => (value ? new Date(value).getTime() : Date.now());

function activityEntry(action: string, user: AuthUser, description: string) {
  return {
    id: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    action,
    actorSessionId: `user-${user.id}`,
    actorDisplayName: displayName(user),
    timestamp: Date.now(),
    description,
  };
}

const createBody = z.object({ id: z.string().min(8).max(64).optional(), title: z.string().max(500).optional(), blocks: z.array(z.any()).optional() });
const updateBody = z.object({
  title: z.string().max(500).optional(),
  blocks: z.array(z.any()).optional(),
  comments: z.array(z.any()).optional(),
  share_settings: z.record(z.any()).optional(),
  word_settings: z.record(z.any()).nullable().optional(),
});
const inviteBody = z.object({ email: z.string().trim().toLowerCase().email(), display_name: z.string().max(200).optional(), role: z.enum(['editor', 'commenter', 'viewer']).default('editor') });

/** Thumbnail for the documents home: the title and the first lines, drawn as SVG. */
function thumbnailSvg(title: string, text: string) {
  const esc = (value: string) => value.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).length > 46) { lines.push(line); line = word; if (lines.length >= 12) break; } else line = line ? `${line} ${word}` : word;
  }
  if (line && lines.length < 12) lines.push(line);
  const body = lines.map((value, index) => `<text x="24" y="${78 + index * 15}" font-size="10.5" fill="#64748b">${esc(value)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="#ffffff"/><text x="24" y="44" font-family="Georgia, serif" font-size="15" font-weight="700" fill="#0f172a">${esc(title.slice(0, 40))}</text><g font-family="Georgia, serif">${body}</g></svg>`;
}

export function documentRoutes() {
  const app = new Hono<{ Variables: AppVariables }>();

  app.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ documents: [], total: 0 });
    const rows = await sql<(DocumentRow & { role: Role; member_count: number; member_emails: string[] })[]>`
      with mine as (
        select d.*, 'owner'::text as role from documents d where d.owner_user_id = ${user.id}
        union all
        select d.*, m.role from documents d join document_members m on m.document_id = d.id
        where m.status = 'active' and (m.user_id = ${user.id} or lower(m.invite_email) = ${user.email}) and d.owner_user_id <> ${user.id}
      )
      select mine.id, mine.title, mine.updated_at, mine.word_count, mine.owner_user_id, mine.share_settings, mine.role,
        (select count(*)::int from document_members dm where dm.document_id = mine.id) as member_count,
        coalesce((select array_agg(dm.invite_email) from document_members dm where dm.document_id = mine.id), '{}') as member_emails
      from mine order by mine.updated_at desc limit 500`;
    const documents = rows.map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: ms(row.updated_at),
      wordCount: row.word_count ?? 0,
      ownerUserId: row.owner_user_id,
      share: row.share_settings || {},
      memberCount: row.member_count,
      memberEmails: row.member_emails,
      currentUserRole: row.role,
      accessSource: row.role === 'owner' ? 'owner' : 'shared',
    }));
    return c.json({ documents, total: documents.length });
  });

  app.post('/', requireUser, async (c) => {
    const user = c.get('user')!;
    const parsed = createBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: 'Invalid document.' });
    const id = parsed.data.id || randomUUID();
    const [existing] = await sql<DocumentRow[]>`select * from documents where id = ${id}`;
    if (existing) {
      if (existing.owner_user_id !== user.id) throw new HTTPException(403, { message: 'Document id already exists' });
      return c.json(documentToRead(existing, await membersOf(id), 'owner'), 201);
    }
    const blocks = parsed.data.blocks || [];
    const text = blocksToText(blocks);
    const title = parsed.data.title || 'Untitled document';
    const share = { isLinkSharingEnabled: false, defaultAccessRole: 'editor', updatedAt: Date.now() };
    const [document] = await sql<DocumentRow[]>`
      insert into documents (id, owner_user_id, title, blocks, share_settings, activity, word_count, search)
      values (${id}, ${user.id}, ${title}, ${sql.json(blocks)}, ${sql.json(share)}, ${sql.json([activityEntry('document_created', user, 'Created the document')])},
              ${countWords(text)}, to_tsvector('simple', ${title + '\n' + text.slice(0, 200_000)}))
      returning *`;
    return c.json(documentToRead(document, [], 'owner'), 201);
  });

  app.get('/:id', async (c) => {
    const { document, role } = await resolveAccess(c.req.param('id'), c.get('user'));
    return c.json(documentToRead(document, await membersOf(document.id), role));
  });

  app.patch('/:id', requireUser, async (c) => {
    const user = c.get('user')!;
    const { document, role } = await resolveAccess(c.req.param('id'), user);
    const parsed = updateBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: 'Invalid update.' });
    const body = parsed.data;
    const editing = body.title !== undefined || body.blocks !== undefined || body.share_settings !== undefined || body.word_settings !== undefined;
    if (editing && !EDIT_ROLES.includes(role)) throw new HTTPException(403, { message: 'Not authorized to edit this document' });
    if (body.share_settings !== undefined && role !== 'owner') throw new HTTPException(403, { message: 'Only the owner can update sharing settings' });
    if (body.comments !== undefined && !COMMENT_ROLES.includes(role)) throw new HTTPException(403, { message: 'Not authorized to comment on this document' });

    const activity = [...(document.activity || [])];
    if (body.title !== undefined && body.title !== document.title) activity.unshift(activityEntry('title_updated', user, `Renamed the document to "${body.title}"`));
    if (body.share_settings !== undefined) activity.unshift(activityEntry('share_updated', user, 'Updated general sharing settings'));
    const title = body.title ?? document.title;
    const blocks = body.blocks ?? document.blocks;
    let wordSettings = document.word_settings;
    if (body.word_settings !== undefined) {
      const { source: _ignored, ...incoming } = body.word_settings || {};
      const source = document.word_settings?.source;
      wordSettings = body.word_settings === null ? null : { ...incoming, ...(source ? { source } : {}) };
    }
    const text = body.blocks !== undefined || body.title !== undefined ? blocksToText(blocks) : null;
    const [updated] = await sql<DocumentRow[]>`
      update documents set
        title = ${title},
        blocks = ${sql.json(blocks as any)},
        comments = ${sql.json((body.comments ?? document.comments) as any)},
        share_settings = ${sql.json((body.share_settings ?? document.share_settings) as any)},
        word_settings = ${wordSettings ? sql.json(wordSettings) : null},
        activity = ${sql.json(activity.slice(0, 40) as any)},
        word_count = ${text === null ? document.word_count : countWords(text)},
        search = ${text === null ? sql`search` : sql`to_tsvector('simple', ${title + '\n' + text.slice(0, 200_000)})`},
        updated_at = now()
      where id = ${document.id}
      returning *`;
    if (body.blocks !== undefined) maybeAutoVersion(updated, user).catch((error) => console.error('auto version failed', error));
    const payload = documentToRead(updated, await membersOf(updated.id), role);
    broadcastDocument(updated.id, c.req.header('x-session-id') || null);
    return c.json(payload);
  });

  app.delete('/:id', requireUser, async (c) => {
    const user = c.get('user')!;
    const [document] = await sql<{ owner_user_id: string }[]>`select owner_user_id from documents where id = ${c.req.param('id')}`;
    if (!document) throw new HTTPException(404, { message: 'Document not found' });
    if (document.owner_user_id !== user.id) throw new HTTPException(403, { message: 'Only the owner can delete this document' });
    await sql`delete from documents where id = ${c.req.param('id')}`;
    return c.json({ success: true });
  });

  app.post('/:id/members', requireUser, async (c) => {
    const user = c.get('user')!;
    const { document, role } = await resolveAccess(c.req.param('id'), user);
    if (role !== 'owner') throw new HTTPException(403, { message: 'Only the owner can invite people' });
    const parsed = inviteBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: 'Enter a valid email address.' });
    if (parsed.data.email === user.email) throw new HTTPException(422, { message: 'You already own this document.' });
    const [invitee] = await sql<{ id: string; full_name: string | null }[]>`select id, full_name from users where email = ${parsed.data.email}`;
    const [member] = await sql<MemberRow[]>`
      insert into document_members (document_id, user_id, invite_email, display_name, role, status, invited_by_user_id)
      values (${document.id}, ${invitee?.id ?? null}, ${parsed.data.email}, ${parsed.data.display_name || invitee?.full_name || null},
              ${parsed.data.role}, ${invitee ? 'active' : 'pending'}, ${user.id})
      on conflict (document_id, invite_email) do update set role = excluded.role
      returning id, invite_email, display_name, role, status, invite_sent, created_at`;
    broadcastDocument(document.id, null);
    // Invitation emails are sent once the mail service is set up; the link works either way.
    return c.json({ member: memberToDict(member), inviteSent: false, inviteUrl: `${env.publicUrl}/editor?doc=${document.id}` });
  });

  app.patch('/:id/members/:memberId', requireUser, async (c) => {
    const { document, role } = await resolveAccess(c.req.param('id'), c.get('user'));
    if (role !== 'owner') throw new HTTPException(403, { message: 'Only the owner can change roles' });
    const parsed = z.object({ role: z.enum(['editor', 'commenter', 'viewer']) }).safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: 'Invalid role.' });
    const [member] = await sql<MemberRow[]>`
      update document_members set role = ${parsed.data.role} where id = ${c.req.param('memberId')} and document_id = ${document.id}
      returning id, invite_email, display_name, role, status, invite_sent, created_at`;
    if (!member) throw new HTTPException(404, { message: 'Member not found' });
    broadcastDocument(document.id, null);
    return c.json(memberToDict(member));
  });

  app.delete('/:id/members/:memberId', requireUser, async (c) => {
    const { document, role } = await resolveAccess(c.req.param('id'), c.get('user'));
    if (role !== 'owner') throw new HTTPException(403, { message: 'Only the owner can remove people' });
    await sql`delete from document_members where id = ${c.req.param('memberId')} and document_id = ${document.id}`;
    broadcastDocument(document.id, null);
    return c.json({ success: true });
  });

  app.get('/:id/thumbnail', async (c) => {
    const { document } = await resolveAccess(c.req.param('id'), c.get('user'));
    c.header('Cache-Control', 'private, max-age=60');
    c.header('Content-Type', 'image/svg+xml');
    return c.body(thumbnailSvg(document.title, blocksToText(document.blocks).slice(0, 1200)));
  });

  return app;
}
