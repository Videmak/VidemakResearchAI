import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { sql } from '../db.js';
import { env } from '../env.js';
import { requireUser, type AppVariables } from '../auth.js';
import type { Slots } from '../slots/types.js';
import { isPublicHttpsUrl, fetchPublic } from '../lib/safeUrl.js';
import { checkLibraryRoom, checkUploadSize, HARD_UPLOAD_MB, libraryLimits } from '../lib/plans.js';
import { deleteFile, keyFromRef, openFile } from '../lib/storage.js';
import { processPdf, storeFile } from '../lib/libraryFiles.js';
import { scholarAccess, scholarPdf } from '../lib/scholar.js';


type LibraryRow = {
  id: string; user_id: string; folder_id: string | null; filename: string; file_type: string; file_path: string | null;
  file_size: number | null; title: string | null; authors: string[]; doi: string | null; publisher: string | null;
  publication_date: string | null; abstract: string | null; metadata: Record<string, unknown>; processing_status: string;
  processing_error: string | null; chunk_count: number; created_at: Date; updated_at: Date; processed_at: Date | null;
};

function toResponse(row: LibraryRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    group_library_id: null,
    filename: row.filename,
    file_type: row.file_type,
    file_size: row.file_size ?? undefined,
    title: row.title ?? undefined,
    authors: row.authors || [],
    doi: row.doi ?? undefined,
    publisher: row.publisher ?? undefined,
    publication_date: row.publication_date ?? undefined,
    abstract: row.abstract ?? undefined,
    metadata: row.metadata || {},
    folder_id: row.folder_id ?? undefined,
    processing_status: row.processing_status,
    processing_error: row.processing_error ?? undefined,
    chunk_count: row.chunk_count,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    processed_at: row.processed_at ? new Date(row.processed_at).toISOString() : undefined,
  };
}

const importBody = z.object({
  url: z.string().max(2000).optional(), pdf_url: z.string().max(2000).optional(), title: z.string().max(1000).optional(),
  authors: z.array(z.string().max(300)).max(200).optional(), doi: z.string().max(300).optional(), year: z.number().int().optional(),
  source: z.string().max(40).optional(), abstract: z.string().max(20000).optional(), scholar_id: z.string().max(200).optional(),
  folder_id: z.string().uuid().optional(),
});

export function libraryRoutes(_slots: Slots) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', requireUser);

  app.get('/documents', async (c) => {
    const user = c.get('user')!;
    const page = Math.max(1, Number(c.req.query('page') || 1));
    const pageSize = Math.min(200, Math.max(1, Number(c.req.query('page_size') || 100)));
    const folderId = c.req.query('folder_id') || null;
    const search = (c.req.query('search') || '').trim();
    const filters = sql`user_id = ${user.id}
      ${folderId ? sql`and folder_id = ${folderId}` : sql``}
      ${c.req.query('unfiled_only') === 'true' ? sql`and folder_id is null` : sql``}
      ${c.req.query('status') ? sql`and processing_status = ${c.req.query('status')!}` : sql``}
      ${search ? sql`and (title ilike ${'%' + search + '%'} or filename ilike ${'%' + search + '%'} or doi ilike ${'%' + search + '%'})` : sql``}`;
    const [{ total }] = await sql<{ total: number }[]>`select count(*)::int as total from library_documents where ${filters}`;
    const rows = await sql<LibraryRow[]>`select * from library_documents where ${filters} order by created_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`;
    return c.json({ documents: rows.map(toResponse), total, page, page_size: pageSize, has_more: page * pageSize < total });
  });

  app.get('/documents/:id', async (c) => {
    const [row] = await sql<LibraryRow[]>`select * from library_documents where id = ${c.req.param('id')} and user_id = ${c.get('user')!.id}`;
    if (!row) throw new HTTPException(404, { message: 'Not found in your Library' });
    return c.json(toResponse(row));
  });

  app.get('/documents/:id/file', async (c) => {
    const [row] = await sql<LibraryRow[]>`select * from library_documents where id = ${c.req.param('id')} and user_id = ${c.get('user')!.id}`;
    const key = keyFromRef(row?.file_path);
    if (!key) throw new HTTPException(404, { message: 'This source has no PDF yet.' });
    const file = await openFile(key);
    if (!file) throw new HTTPException(404, { message: 'The PDF file is missing.' });
    c.header('Content-Type', 'application/pdf');
    if (file.size !== null) c.header('Content-Length', String(file.size));
    c.header('Content-Disposition', `inline; filename="${(row!.filename || 'document.pdf').replace(/[^\x20-\x7e]|"/g, '')}"`);
    c.header('Cache-Control', 'private, max-age=300');
    return c.body(file.body);
  });

  app.delete('/documents/:id', async (c) => {
    const [row] = await sql<LibraryRow[]>`delete from library_documents where id = ${c.req.param('id')} and user_id = ${c.get('user')!.id} returning *`;
    const key = keyFromRef(row?.file_path);
    if (key) await deleteFile(key);
    return c.json({ success: Boolean(row) });
  });

  app.post('/documents/upload', async (c) => {
    const user = c.get('user')!;
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw new HTTPException(422, { message: 'Choose a PDF to upload.' });
    await checkUploadSize(user.account_id, file.size);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw new HTTPException(415, { message: 'Only PDF files can be added for now.' });
    await checkLibraryRoom(user.account_id, user.id);
    const folderId = typeof form?.get('folder_id') === 'string' && form?.get('folder_id') ? String(form.get('folder_id')) : null;
    const title = typeof form?.get('title') === 'string' && form?.get('title') ? String(form.get('title')) : file.name.replace(/\.pdf$/i, '');
    const [row] = await sql<LibraryRow[]>`
      insert into library_documents (user_id, folder_id, filename, file_type, file_size, title, processing_status)
      values (${user.id}, ${folderId}, ${file.name.slice(0, 300)}, 'pdf', ${file.size}, ${title.slice(0, 1000)}, 'pending') returning *`;
    const fileKey = await storeFile(user.id, row.id, bytes).catch(async (error) => {
      await sql`delete from library_documents where id = ${row.id}`;
      console.error(`library upload: ${(error as Error).message}`);
      throw new HTTPException(503, { message: 'The file could not be saved right now. Try again in a minute.' });
    });
    await sql`update library_documents set file_path = ${fileKey} where id = ${row.id}`;
    void processPdf(row.id, fileKey);
    return c.json({ id: row.id, filename: row.filename, file_type: 'pdf', file_size: file.size, processing_status: 'pending', message: 'Added to your Library. Reading the PDF now.' });
  });

  /** Saves a paper (from Find papers or a citation card) with its PDF when Scholar or an open-access link has one. */
  app.post('/papers/import', async (c) => {
    const user = c.get('user')!;
    const parsed = importBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: 'This paper could not be read.' });
    const paper = parsed.data;
    const doi = paper.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim() || null;
    if (doi) {
      const [existing] = await sql<{ id: string }[]>`select id from library_documents where user_id = ${user.id} and lower(doi) = ${doi.toLowerCase()}`;
      if (existing) return c.json({ success: true, document_id: existing.id, message: 'Already in your Library', processing_status: 'completed' });
    }
    // The PDF: Scholar's stored copy when it has one (by OpenAlex work id), else the open-access link.
    const workId = /^W\d+$/i.test(paper.scholar_id ?? '') ? paper.scholar_id! : null;
    const openLink = paper.pdf_url && (await isPublicHttpsUrl(paper.pdf_url)) ? paper.pdf_url : null;
    const tryPdf = Boolean(openLink || (workId && scholarAccess()));
    if (tryPdf) await checkLibraryRoom(user.account_id, user.id);
    const [row] = await sql<LibraryRow[]>`
      insert into library_documents (user_id, folder_id, filename, file_type, title, authors, doi, publication_date, abstract, metadata, processing_status)
      values (${user.id}, ${paper.folder_id ?? null}, ${(paper.title || 'Untitled paper').slice(0, 300)}, ${tryPdf ? 'pdf' : 'reference'},
              ${paper.title ?? null}, ${sql.json(paper.authors ?? [])}, ${doi}, ${paper.year ? String(paper.year) : null}, ${paper.abstract ?? null},
              ${sql.json({ source: paper.source ?? 'search', url: paper.url ?? null, scholar_id: paper.scholar_id ?? null, pdf_url: paper.pdf_url ?? null })},
              ${tryPdf ? 'pending' : 'completed'})
      returning *`;
    if (paper.abstract) {
      await sql`insert into library_chunks (document_id, chunk_index, page, content) values (${row.id}, 0, null, ${`${paper.title ?? ''}\n\n${paper.abstract}`})`;
      await sql`update library_documents set chunk_count = 1 where id = ${row.id}`;
    }
    if (tryPdf) {
      void (async () => {
        try {
          let bytes: Uint8Array | null = null;
          let link = openLink;
          if (workId) {
            const stored = await scholarPdf(workId).catch(() => null);
            if (stored && 'bytes' in stored) bytes = new Uint8Array(stored.bytes);
            else if (stored && 'url' in stored && !link && (await isPublicHttpsUrl(stored.url))) link = stored.url;
          }
          if (!bytes && link) {
            const response = await fetchPublic(link, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'Videmak/0.1 (+https://videmak.net)' } });
            bytes = response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
          }
          if (!bytes || bytes.byteLength > HARD_UPLOAD_MB * 1024 * 1024 || !(bytes[0] === 0x25 && bytes[1] === 0x50)) throw new Error('No PDF available');
          const fileKey = await storeFile(user.id, row.id, bytes);
          await sql`update library_documents set file_path = ${fileKey}, file_size = ${bytes.byteLength} where id = ${row.id}`;
          await processPdf(row.id, fileKey);
        } catch {
          await sql`update library_documents set processing_status = 'completed', file_type = 'reference' where id = ${row.id}`;
        }
      })();
    }
    return c.json({ success: true, document_id: row.id, message: 'Saved to your Library', processing_status: row.processing_status });
  });

  app.get('/folders', async (c) => {
    const rows = await sql`
      select f.id, f.name, f.parent_id, f.source, f.created_at,
        (select count(*)::int from library_documents d where d.folder_id = f.id) as document_count
      from library_folders f where f.user_id = ${c.get('user')!.id} order by f.name`;
    return c.json(rows.map((row: any) => ({ ...row, group_library_id: null, created_at: new Date(row.created_at).toISOString() })));
  });

  app.post('/folders', async (c) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(120), parent_id: z.string().uuid().nullable().optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: 'Give the folder a name.' });
    const [row] = await sql`insert into library_folders (user_id, name, parent_id) values (${c.get('user')!.id}, ${parsed.data.name}, ${parsed.data.parent_id ?? null}) returning id, name, parent_id, source, created_at`;
    return c.json({ ...row, document_count: 0, group_library_id: null }, 201);
  });

  return app;
}
