/**
 * Database access for the editor assistant: chat threads, document access checks and a
 * simple full-text search over the writer's Library chunks.
 */
import { sql } from '../db.js';

export type StoredChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  selection?: string;
  sources?: unknown[];
};

export type ChatThread = {
  id: string;
  document_id: string | null;
  user_id: string;
  title: string;
  messages: StoredChatMessage[];
  updated_at: Date;
};

export type ChatThreadSummary = { id: string; title: string; updated_at: Date; message_count: number };

export type LibraryDocument = {
  id: string;
  filename: string;
  title: string | null;
  authors: unknown;
  doi: string | null;
  publisher: string | null;
  publication_date: string | null;
  abstract: string | null;
  metadata: Record<string, unknown> | null;
};

export type LibraryHit = { document: LibraryDocument; passages: { content: string; page: number | null }[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

// ------------------------------------------------------------------ chat threads

/** A document's threads, or the writer's standalone threads (AI Chat page) when documentId is null. */
export async function listChatThreads(userId: string, documentId: string | null): Promise<ChatThreadSummary[]> {
  const scope = documentId === null ? sql`document_id is null` : sql`document_id = ${documentId}`;
  return sql<ChatThreadSummary[]>`
    select id, title, updated_at, jsonb_array_length(messages)::int as message_count
    from chat_threads where user_id = ${userId} and ${scope}
    order by updated_at desc limit 50`;
}

export async function getChatThread(threadId: string, userId: string): Promise<ChatThread | null> {
  if (!isUuid(threadId)) return null;
  const [row] = await sql<ChatThread[]>`
    select id, document_id, user_id, title, messages, updated_at
    from chat_threads where id = ${threadId} and user_id = ${userId}`;
  return row ?? null;
}

export async function createChatThread(documentId: string | null, userId: string, title: string): Promise<ChatThread> {
  const [row] = await sql<ChatThread[]>`
    insert into chat_threads (document_id, user_id, title) values (${documentId}, ${userId}, ${title})
    returning id, document_id, user_id, title, messages, updated_at`;
  return row;
}

/** Adds messages to a thread, keeping the newest 200. */
export async function appendChatMessages(threadId: string, messages: StoredChatMessage[]): Promise<void> {
  await sql.begin(async (tx) => {
    const [row] = await tx<{ messages: StoredChatMessage[] }[]>`select messages from chat_threads where id = ${threadId} for update`;
    if (!row) return;
    const next = [...(Array.isArray(row.messages) ? row.messages : []), ...messages].slice(-200);
    await tx`update chat_threads set messages = ${tx.json(next as any)}, updated_at = now() where id = ${threadId}`;
  });
}

export async function deleteChatThread(threadId: string, userId: string): Promise<boolean> {
  if (!isUuid(threadId)) return false;
  const rows = await sql`delete from chat_threads where id = ${threadId} and user_id = ${userId} returning id`;
  return rows.length > 0;
}

// ------------------------------------------------------------------ Library

const documentColumns = () => sql`d.id, d.filename, d.title, d.authors, d.doi, d.publisher, d.publication_date, d.abstract, d.metadata`;

/**
 * Passages from the writer's Library that match the words of `query` (any of them; more
 * matches rank higher), grouped by document. `documentIds` narrows the search when given.
 */
export async function searchLibrary(userId: string, query: string, documentIds: string[], limit: number): Promise<LibraryHit[]> {
  const terms = [...new Set((query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) || []))].slice(0, 12);
  if (!terms.length) return [];
  const ids = documentIds.filter(isUuid);
  if (documentIds.length && !ids.length) return [];
  const tsquery = terms.join(' or ');
  const scope = ids.length ? sql`and d.id = any(${sql.array(ids)}::uuid[])` : sql``;
  const rows = await sql<(LibraryDocument & { content: string; page: number | null })[]>`
    select ${documentColumns()}, c.content, c.page
    from library_chunks c
    join library_documents d on d.id = c.document_id
    where d.user_id = ${userId} ${scope}
      and c.search @@ websearch_to_tsquery('simple', ${tsquery})
    order by ts_rank(c.search, websearch_to_tsquery('simple', ${tsquery})) desc
    limit ${limit * 6}`;
  const hits = new Map<string, LibraryHit>();
  for (const { content, page, ...doc } of rows) {
    const hit = hits.get(doc.id) ?? { document: doc, passages: [] };
    if (!hits.has(doc.id)) {
      if (hits.size >= limit) continue;
      hits.set(doc.id, hit);
    }
    if (hit.passages.length < 2) hit.passages.push({ content, page });
  }
  return [...hits.values()];
}

/** The writer's own Library documents, by id (others' ids are ignored). */
/** The writer's Library documents in these folders (Autocomplete's "limit Library to"). */
export async function libraryDocumentIdsInFolders(userId: string, folderIds: string[]): Promise<string[]> {
  const ids = folderIds.filter(isUuid);
  if (!ids.length) return [];
  const rows = await sql<{ id: string }[]>`
    select id from library_documents where user_id = ${userId} and folder_id = any(${sql.array(ids)}::uuid[]) limit 300`;
  return rows.map((row) => row.id);
}

export async function getLibraryDocuments(userId: string, documentIds: string[]): Promise<LibraryDocument[]> {
  const ids = documentIds.filter(isUuid);
  if (!ids.length) return [];
  return sql<LibraryDocument[]>`
    select ${documentColumns()} from library_documents d
    where d.user_id = ${userId} and d.id = any(${sql.array(ids)}::uuid[])`;
}
