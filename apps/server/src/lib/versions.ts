import { sql } from '../db.js';
import type { AuthUser } from '../auth.js';
import type { DocumentRow } from './access.js';
import { displayName } from './access.js';
import { blocksToText, countWords, countBlocks } from './blocks.js';

export type VersionReason = 'auto' | 'import' | 'manual' | 'before-restore' | 'restore' | 'ai';
export const AI_AUTHOR = 'Videmak AI';
const AI_MERGE_MS = 5 * 60 * 1000;
const AUTO_INTERVAL_MS = 10 * 60 * 1000;
const KEEP_UNNAMED = 60;

export type VersionRow = {
  id: string; created_at: Date; author_name: string; reason: VersionReason; label: string | null;
  title: string; word_count: number; block_count: number;
};

export function versionSummary(version: VersionRow) {
  return {
    id: version.id,
    createdAt: new Date(version.created_at).toISOString(),
    authorName: version.author_name,
    reason: version.reason,
    label: version.label,
    title: version.title,
    wordCount: version.word_count,
    blockCount: version.block_count,
  };
}

/** Keeps the document's current content as a version. Same content as the newest version → that one. */
export async function createVersion(document: DocumentRow, user: AuthUser | null, reason: VersionReason, label: string | null = null) {
  const [latest] = await sql<(VersionRow & { blocks: unknown })[]>`
    select id, created_at, author_name, reason, label, title, word_count, block_count, blocks
    from document_versions where document_id = ${document.id} order by created_at desc limit 1`;
  if (latest && JSON.stringify(latest.blocks) === JSON.stringify(document.blocks) && latest.title === document.title) {
    if (label && !latest.label) {
      const [renamed] = await sql<VersionRow[]>`update document_versions set label = ${label} where id = ${latest.id} returning id, created_at, author_name, reason, label, title, word_count, block_count`;
      return renamed;
    }
    return latest;
  }
  const text = blocksToText(document.blocks);
  // Accepted AI text: one history entry per burst of suggestions (newest five minutes), not one per Tab.
  if (reason === 'ai' && latest && latest.reason === 'ai' && Date.now() - new Date(latest.created_at).getTime() < AI_MERGE_MS) {
    const [merged] = await sql<VersionRow[]>`
      update document_versions set blocks = ${sql.json(document.blocks as any)}, title = ${document.title}, label = ${label},
        word_count = ${countWords(text)}, block_count = ${countBlocks(document.blocks)}, created_at = now()
      where id = ${latest.id}
      returning id, created_at, author_name, reason, label, title, word_count, block_count`;
    return merged;
  }
  const [version] = await sql<VersionRow[]>`
    insert into document_versions (document_id, author_user_id, author_name, reason, label, title, blocks, word_settings, word_count, block_count)
    values (${document.id}, ${user?.id ?? null}, ${reason === 'ai' ? AI_AUTHOR : user ? displayName(user) : ''}, ${reason}, ${label}, ${document.title},
            ${sql.json(document.blocks as any)}, ${document.word_settings ? sql.json(document.word_settings) : null}, ${countWords(text)}, ${countBlocks(document.blocks)})
    returning id, created_at, author_name, reason, label, title, word_count, block_count`;
  // Keep named versions forever and the newest unnamed ones.
  await sql`
    delete from document_versions where document_id = ${document.id} and label is null and id not in (
      select id from document_versions where document_id = ${document.id} and label is null order by created_at desc limit ${KEEP_UNNAMED})`;
  return version;
}

/** At most one automatic version every 10 minutes per document. */
export async function maybeAutoVersion(document: DocumentRow, user: AuthUser) {
  const [latest] = await sql<{ created_at: Date }[]>`select created_at from document_versions where document_id = ${document.id} order by created_at desc limit 1`;
  if (latest && Date.now() - new Date(latest.created_at).getTime() < AUTO_INTERVAL_MS) return null;
  return createVersion(document, user, 'auto');
}
