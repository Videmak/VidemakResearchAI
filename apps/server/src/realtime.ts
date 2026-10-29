import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { sql } from './db.js';
import { userFromToken, type AuthUser } from './auth.js';
import { resolveAccess, displayName, EDIT_ROLES, COMMENT_ROLES, type DocumentRow, type Role } from './lib/access.js';
import { documentToRead, membersOf } from './lib/documentPayload.js';
import { blocksToText, countWords } from './lib/blocks.js';
import { maybeAutoVersion } from './lib/versions.js';

/**
 * Presence and document-metadata channel (/api/ai-editor/documents/:id/ws), the protocol the
 * copied editor speaks: join / presence:heartbeat / cursor:update / document:update in;
 * sync:init / sync:document / sync:presence / error / pong out. Document text itself syncs over
 * Hocuspocus (collab.ts). State lives in this process; several processes would share it via Valkey.
 */

type Presence = {
  sessionId: string;
  displayName: string;
  color: string;
  role: Role;
  cursor: unknown;
  lastSeenAt: number;
};

type Client = { socket: WebSocket; documentId: string; user: AuthUser | null; role: Role; sessionId: string | null };

const PRESENCE_TTL_MS = 30_000;
const rooms = new Map<string, Set<Client>>();
const presence = new Map<string, Map<string, Presence>>();
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });

const PATH = /^\/api\/ai-editor\/documents\/([^/]+)\/ws$/;

function send(client: Client, payload: unknown) {
  if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(payload));
}

function sanitizeCursor(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const json = JSON.stringify(value);
  return json.length > 2000 ? null : JSON.parse(json);
}

function collaborators(documentId: string, currentSessionId: string | null) {
  const now = Date.now();
  const entries = presence.get(documentId) ?? new Map();
  for (const [id, entry] of entries) if (now - entry.lastSeenAt > PRESENCE_TTL_MS) entries.delete(id);
  return [...entries.values()]
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map((entry) => ({ ...entry, isCurrentUser: entry.sessionId === currentSessionId }));
}

function broadcastPresence(documentId: string) {
  for (const client of rooms.get(documentId) ?? []) send(client, { type: 'sync:presence', collaborators: collaborators(documentId, client.sessionId) });
}

async function snapshotFor(client: Client, document?: DocumentRow) {
  const access = document ? { document, role: client.role } : await resolveAccess(client.documentId, client.user);
  client.role = access.role;
  return documentToRead(access.document, await membersOf(client.documentId), access.role);
}

/** Tells everyone viewing a document that its title, comments, sharing or blocks changed. */
export function broadcastDocument(documentId: string, exceptSessionId: string | null) {
  const clients = rooms.get(documentId);
  if (!clients?.size) return;
  void (async () => {
    const [document] = await sql<DocumentRow[]>`select * from documents where id = ${documentId}`;
    if (!document) return;
    const members = await membersOf(documentId);
    for (const client of clients) {
      if (exceptSessionId && client.sessionId === exceptSessionId) continue;
      send(client, { type: 'sync:document', snapshot: documentToRead(document, members, client.role) });
    }
  })().catch((error) => console.error('broadcastDocument failed', error));
}

function touch(client: Client, message: Record<string, any>) {
  if (!client.sessionId) return;
  const entries = presence.get(client.documentId) ?? new Map<string, Presence>();
  presence.set(client.documentId, entries);
  const previous = entries.get(client.sessionId);
  entries.set(client.sessionId, {
    sessionId: client.sessionId,
    displayName: String(message.displayName || previous?.displayName || (client.user ? displayName(client.user) : 'Guest')).slice(0, 80),
    color: String(message.color || previous?.color || '#2563eb').slice(0, 32),
    role: client.role,
    cursor: message.cursor !== undefined ? sanitizeCursor(message.cursor) : previous?.cursor ?? null,
    lastSeenAt: Date.now(),
  });
}

/**
 * Comments sent from an older copy of the document: the sender's list wins, plus comments others
 * added after that copy (createdAt after `baseRevision`), which the sender could not have seen.
 */
export function mergeStaleComments(current: any[], incoming: any[], baseRevision: number): any[] {
  const sent = new Set(incoming.map((comment) => comment?.id));
  const addedElsewhere = current.filter((comment) => comment && !sent.has(comment.id) && Number(comment.createdAt) > baseRevision);
  return [...addedElsewhere, ...incoming];
}

async function applyUpdate(client: Client, message: Record<string, any>) {
  const wantsEdit = typeof message.title === 'string' || Array.isArray(message.blocks);
  if (wantsEdit && !EDIT_ROLES.includes(client.role)) return send(client, { type: 'error', detail: 'Not authorized to edit this document' });
  if (Array.isArray(message.comments) && !COMMENT_ROLES.includes(client.role)) return send(client, { type: 'error', detail: 'Not authorized to comment on this document' });
  const [current] = await sql<DocumentRow[]>`select * from documents where id = ${client.documentId}`;
  if (!current) return send(client, { type: 'error', detail: 'Document not found' });
  const stale = typeof message.baseRevision === 'number' && new Date(current.updated_at).getTime() > message.baseRevision;
  // Live documents keep their text in the Yjs document (/collab), whose saves also move updated_at;
  // the blocks JSON is only a readable copy of it, so a newer copy always wins. Rejecting it as
  // "stale" left exports, versions and search on the text from when the document was created.
  const live = Boolean((current as { ydoc?: unknown }).ydoc);
  // A stale editor of a document without live sync gets the newer document instead of overwriting
  // it. A stale comments-only change is merged instead: dropping it lost comments (and AI review
  // results) whenever the text had been saved in the meantime.
  if (stale && wantsEdit && !live) {
    return send(client, { type: 'sync:document', snapshot: await snapshotFor(client, current) });
  }
  if (stale && Array.isArray(message.comments)) {
    message.comments = mergeStaleComments(current.comments || [], message.comments, message.baseRevision);
  }
  const title = typeof message.title === 'string' ? message.title.trim() || 'Untitled document' : current.title;
  const blocks = Array.isArray(message.blocks) ? message.blocks : current.blocks;
  const comments = Array.isArray(message.comments) ? message.comments : current.comments;
  const activity = [...(current.activity || [])];
  if (title !== current.title && client.user) {
    activity.unshift({ id: `${Date.now()}`, action: 'title_updated', actorSessionId: `user-${client.user.id}`, actorDisplayName: displayName(client.user), timestamp: Date.now(), description: `Renamed the document to "${title}"` });
  }
  const text = Array.isArray(message.blocks) || title !== current.title ? blocksToText(blocks) : null;
  const [updated] = await sql<DocumentRow[]>`
    update documents set title = ${title}, blocks = ${sql.json(blocks as any)}, comments = ${sql.json(comments as any)},
      activity = ${sql.json(activity.slice(0, 40) as any)},
      word_count = ${text === null ? current.word_count : countWords(text)},
      search = ${text === null ? sql`search` : sql`to_tsvector('simple', ${title + '\n' + text.slice(0, 200_000)})`},
      updated_at = now()
    where id = ${client.documentId} returning *`;
  if (Array.isArray(message.blocks) && client.user) maybeAutoVersion(updated, client.user).catch(() => undefined);
  touch(client, message);
  broadcastDocument(client.documentId, null);
  broadcastPresence(client.documentId);
}

wss.on('connection', (socket: WebSocket, request: IncomingMessage, documentId: string, user: AuthUser | null, role: Role) => {
  const client: Client = { socket, documentId, user, role, sessionId: null };
  const room = rooms.get(documentId) ?? new Set<Client>();
  room.add(client);
  rooms.set(documentId, room);

  socket.on('message', (raw) => {
    let message: Record<string, any>;
    try { message = JSON.parse(String(raw)); } catch { return; }
    void (async () => {
      switch (message.type) {
        case 'join': {
          client.sessionId = String(message.sessionId || '').slice(0, 80) || null;
          touch(client, message);
          send(client, { type: 'sync:init', snapshot: await snapshotFor(client), collaborators: collaborators(documentId, client.sessionId) });
          broadcastPresence(documentId);
          break;
        }
        case 'presence:heartbeat':
        case 'cursor:update':
          touch(client, message);
          broadcastPresence(documentId);
          break;
        case 'document:update':
          await applyUpdate(client, message);
          break;
        case 'ping':
          send(client, { type: 'pong' });
          break;
        default:
          break;
      }
    })().catch((error) => {
      console.error('realtime message failed', error);
      send(client, { type: 'error', detail: 'The change could not be saved.' });
    });
  });

  socket.on('close', () => {
    room.delete(client);
    if (!room.size) rooms.delete(documentId);
    if (client.sessionId) presence.get(documentId)?.delete(client.sessionId);
    broadcastPresence(documentId);
  });
});

/** Upgrades /api/ai-editor/documents/:id/ws requests; returns false for other paths. */
export function handleRealtimeUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = new URL(request.url || '/', 'http://localhost');
  const match = PATH.exec(url.pathname);
  if (!match) return false;
  const documentId = decodeURIComponent(match[1]);
  void (async () => {
    const user = await userFromToken(url.searchParams.get('token'));
    try {
      const { role } = await resolveAccess(documentId, user);
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request, documentId, user, role));
    } catch {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
  })();
  return true;
}
