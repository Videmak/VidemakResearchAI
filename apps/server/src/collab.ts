import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import { WebSocketServer } from 'ws';
import { sql } from './db.js';
import { userFromToken } from './auth.js';
import { resolveAccess, EDIT_ROLES } from './lib/access.js';

/**
 * Real-time document sync (Yjs over Hocuspocus) at /collab. The document name is the
 * document id; the connection's token decides access, exactly like the HTTP API.
 */
export const hocuspocus = Server.configure({
  quiet: true,
  debounce: 1500,
  maxDebounce: 8000,
  timeout: 30_000,
  async onAuthenticate({ token, documentName, connection }) {
    const user = await userFromToken(token);
    const { role } = await resolveAccess(documentName, user).catch(() => {
      throw new Error('Forbidden');
    });
    if (!EDIT_ROLES.includes(role)) connection.readOnly = true;
    return { userId: user?.id ?? null, role };
  },
  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        const [row] = await sql<{ ydoc: Buffer | null }[]>`select ydoc from documents where id = ${documentName}`;
        return row?.ydoc ? new Uint8Array(row.ydoc) : null;
      },
      store: async ({ documentName, state }) => {
        await sql`update documents set ydoc = ${Buffer.from(state)}, updated_at = now() where id = ${documentName}`;
      },
    }),
  ],
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });

/** Upgrades /collab requests; returns false for other paths. */
export function handleCollabUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = new URL(request.url || '/', 'http://localhost');
  if (url.pathname !== '/collab' && url.pathname !== '/api/collab') return false;
  wss.handleUpgrade(request, socket, head, (ws) => hocuspocus.handleConnection(ws, request));
  return true;
}
