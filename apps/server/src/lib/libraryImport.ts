import { sql } from '../db.js';
import { checkLibraryRoom, HARD_UPLOAD_MB, PlanLimitError } from './plans.js';
import { processPdf, storeFile } from './libraryFiles.js';
import { isPublicHttpsUrl, fetchPublic } from './safeUrl.js';
import { scholarPdf } from './scholar.js';
import type { AuthUser } from '../auth.js';

/**
 * Imports into the Library (Zotero, Mendeley, .bib/.ris files, pasted identifiers) run in the
 * background as a job the browser polls. Each item becomes a reference; its PDF is added when
 * the source has one and the plan has room (PDFs count towards the plan's Library size,
 * references do not). Items already in the Library (same DOI or same source id) are skipped.
 */

export type ImportSource = 'zotero' | 'mendeley' | 'bibtex' | 'ris' | 'ids';

export type ImportEntry = {
  title: string;
  authors: string[];
  year: string | null;
  doi: string | null;
  journal: string | null;
  url: string | null;
  abstract: string | null;
  /** "zotero:ABCD1234": importing the same item again is skipped. */
  externalId?: string | null;
  /** Extra details kept on the row (BibTeX, source keys, OpenAlex work id…). */
  metadata?: Record<string, unknown>;
  /** The PDF from the source itself (a Zotero or Mendeley attachment). */
  pdf?: (() => Promise<Uint8Array | null>) | null;
  /** Else: an OpenAlex work id for Scholar's stored copy, or an open-access link. */
  workId?: string | null;
  pdfUrl?: string | null;
};

export type ImportJob = {
  id: string; source: ImportSource; label: string; status: 'running' | 'done' | 'failed';
  total: number; added: number; pdfs: number; skipped: number; failed: number; pdfs_over_limit: number;
  error: string | null; created_at: Date; finished_at: Date | null;
};

/** A user may run one import at a time. */
const running = new Set<string>();

export const isImporting = (userId: string) => running.has(userId);

export async function startImportJob(userId: string, source: ImportSource, label: string) {
  const [job] = await sql<{ id: string }[]>`insert into library_import_jobs (user_id, source, label) values (${userId}, ${source}, ${label.slice(0, 200)}) returning id`;
  return job.id;
}

export async function importJob(userId: string, jobId: string) {
  const [job] = await sql<ImportJob[]>`select * from library_import_jobs where id = ${jobId} and user_id = ${userId}`;
  return job ?? null;
}

const isPdf = (bytes: Uint8Array | null) => Boolean(bytes && bytes.byteLength > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);

async function findPdf(entry: ImportEntry): Promise<Uint8Array | null> {
  if (entry.pdf) {
    const bytes = await entry.pdf().catch(() => null);
    if (isPdf(bytes)) return bytes;
  }
  let link = entry.pdfUrl ?? null;
  if (entry.workId) {
    const stored = await scholarPdf(entry.workId).catch(() => null);
    if (stored && 'bytes' in stored) return new Uint8Array(stored.bytes);
    if (stored && 'url' in stored && !link) link = stored.url;
  }
  if (link && (await isPublicHttpsUrl(link))) {
    const response = await fetchPublic(link, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'Videmak/0.1 (+https://videmak.net)' } }).catch(() => null);
    const bytes = response?.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    if (isPdf(bytes)) return bytes;
  }
  return null;
}

/**
 * Runs an import (call without awaiting; the job row carries the progress). `entries` may be a
 * list or an async source (Zotero and Mendeley page through their APIs); null counts as failed.
 */
export async function runImport(
  jobId: string,
  user: Pick<AuthUser, 'id' | 'account_id'>,
  entries: AsyncIterable<ImportEntry | null> | Iterable<ImportEntry | null>,
  options: { folderId: string | null; source: ImportSource; findPdfs: boolean; total?: number },
) {
  running.add(user.id);
  const counts = { total: options.total ?? 0, added: 0, pdfs: 0, skipped: 0, failed: 0, pdfs_over_limit: 0 };
  let roomLeft = true;
  const save = () => sql`
    update library_import_jobs set total = ${Math.max(counts.total, counts.added + counts.skipped + counts.failed)}, added = ${counts.added}, pdfs = ${counts.pdfs},
      skipped = ${counts.skipped}, failed = ${counts.failed}, pdfs_over_limit = ${counts.pdfs_over_limit}
    where id = ${jobId}`;
  try {
    let since = Date.now();
    for await (const entry of entries as AsyncIterable<ImportEntry | null>) {
      // null: an item the source named but that could not be read (an unknown DOI, say).
      if (!entry) { counts.failed += 1; continue; }
      try {
        // Without a DOI or a source id, the same title already in the Library counts as the same item.
        if (!entry.doi && !entry.externalId) {
          const [same] = await sql`select 1 from library_documents where user_id = ${user.id} and lower(title) = lower(${entry.title.slice(0, 1000)}) limit 1`;
          if (same) { counts.skipped += 1; continue; }
        }
        const [row] = await sql<{ id: string }[]>`
          insert into library_documents (user_id, folder_id, filename, file_type, title, authors, doi, publisher, publication_date, abstract, metadata, processing_status, external_id)
          values (${user.id}, ${options.folderId}, ${entry.title.slice(0, 300)}, 'reference', ${entry.title.slice(0, 1000)}, ${sql.json(entry.authors.slice(0, 200))},
                  ${entry.doi}, ${entry.journal?.slice(0, 500) ?? null}, ${entry.year}, ${entry.abstract?.slice(0, 20000) ?? null},
                  ${sql.json({ source: options.source, url: entry.url, journal: entry.journal, ...(entry.metadata || {}) } as any)}, 'completed', ${entry.externalId ?? null})
          on conflict do nothing
          returning id`;
        if (!row) { counts.skipped += 1; continue; }
        counts.added += 1;
        if (entry.abstract) {
          await sql`insert into library_chunks (document_id, chunk_index, page, content) values (${row.id}, 0, null, ${`${entry.title}\n\n${entry.abstract}`.slice(0, 20000)})`;
          await sql`update library_documents set chunk_count = 1 where id = ${row.id}`;
        }
        if (options.findPdfs && roomLeft) {
          try {
            await checkLibraryRoom(user.account_id, user.id);
          } catch (error) {
            if (!(error instanceof PlanLimitError)) throw error;
            roomLeft = false;
          }
          if (roomLeft) {
            const bytes = await findPdf(entry);
            if (bytes && bytes.byteLength <= HARD_UPLOAD_MB * 1024 * 1024) {
              const key = await storeFile(user.id, row.id, bytes);
              await sql`update library_documents set file_type = 'pdf', file_path = ${key}, file_size = ${bytes.byteLength}, processing_status = 'pending' where id = ${row.id}`;
              await processPdf(row.id, key);
              counts.pdfs += 1;
            }
          }
        }
        if (options.findPdfs && !roomLeft && (entry.pdf || entry.workId || entry.pdfUrl)) counts.pdfs_over_limit += 1;
      } catch (error) {
        counts.failed += 1;
        console.error(`library import ${jobId}: ${(error as Error).message.slice(0, 200)}`);
      }
      if (Date.now() - since > 1000) { await save(); since = Date.now(); }
    }
    await save();
    await sql`update library_import_jobs set status = 'done', finished_at = now() where id = ${jobId}`;
  } catch (error) {
    await save().catch(() => undefined);
    await sql`update library_import_jobs set status = 'failed', error = ${(error as Error).message.slice(0, 300)}, finished_at = now() where id = ${jobId}`;
  } finally {
    running.delete(user.id);
  }
}

/** Jobs cut off by a restart are marked as stopped (what was imported stays). */
export async function closeInterruptedImports() {
  await sql`update library_import_jobs set status = 'failed', error = 'Stopped by a server restart. Import again to finish: items already added are skipped.', finished_at = now()
    where status = 'running'`;
}
