import { sql } from '../db.js';
import { env } from '../env.js';
import { pdfAuthors, pdfDoi, pdfTitle } from './pdfMetadata.js';
import { readFileBytes, saveFile } from './storage.js';

/** Library PDFs: saving the file and reading it into searchable chunks (uploads and imports). */

const CHUNK_CHARS = 1800;

/** Splits page text into ~1,800-character chunks on paragraph or sentence edges. */
export function chunkPages(pages: { page: number; text: string }[]) {
  const chunks: { page: number; content: string }[] = [];
  for (const { page, text } of pages) {
    const clean = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    let rest = clean;
    while (rest.length > 0) {
      if (rest.length <= CHUNK_CHARS) { chunks.push({ page, content: rest }); break; }
      let cut = rest.lastIndexOf('\n\n', CHUNK_CHARS);
      if (cut < CHUNK_CHARS * 0.5) cut = rest.lastIndexOf('. ', CHUNK_CHARS) + 1;
      if (cut < CHUNK_CHARS * 0.5) cut = CHUNK_CHARS;
      chunks.push({ page, content: rest.slice(0, cut).trim() });
      rest = rest.slice(cut).trim();
    }
  }
  return chunks.filter((chunk) => chunk.content.length > 20);
}

/** Extracts a PDF's text through the converter and stores it as searchable chunks. */
export async function processPdf(documentId: string, fileKey: string) {
  try {
    await sql`update library_documents set processing_status = 'processing' where id = ${documentId}`;
    const form = new FormData();
    const bytes = await readFileBytes(fileKey);
    if (!bytes) throw new Error('The PDF file is missing.');
    form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'document.pdf');
    const response = await fetch(`${env.convertUrl}/pdf/text`, { method: 'POST', body: form, signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`text extraction failed (${response.status})`);
    const result = (await response.json()) as { pages: { page: number; text: string }[]; title?: string | null; metadata?: Record<string, unknown> };
    // The PDF's own title, authors and DOI, when they look real (the upload starts with the file name).
    const title = pdfTitle(result.title);
    const authors = pdfAuthors(result.metadata?.Author);
    const doi = pdfDoi(result.pages?.[0]?.text || '');
    const chunks = chunkPages(result.pages || []);
    await sql.begin(async (tx) => {
      await tx`delete from library_chunks where document_id = ${documentId}`;
      for (let index = 0; index < chunks.length; index += 200) {
        const batch = chunks.slice(index, index + 200).map((chunk, offset) => ({ document_id: documentId, chunk_index: index + offset, page: chunk.page, content: chunk.content }));
        await tx`insert into library_chunks ${tx(batch, 'document_id', 'chunk_index', 'page', 'content')}`;
      }
      await tx`
        update library_documents set processing_status = ${chunks.length ? 'completed' : 'failed'},
          processing_error = ${chunks.length ? null : 'No text found in this PDF (it may be a scan).'},
          chunk_count = ${chunks.length}, processed_at = now(), updated_at = now(),
          title = case when ${title}::text is not null and (title is null or title = regexp_replace(filename, '\\.pdf$', '', 'i')) then ${title} else title end,
          authors = case when coalesce(jsonb_array_length(authors), 0) = 0 then ${tx.json(authors)} else authors end,
          doi = coalesce(doi, ${doi})
        where id = ${documentId}`;
    });
  } catch (error) {
    await sql`update library_documents set processing_status = 'failed', processing_error = ${(error as Error).message.slice(0, 300)}, updated_at = now() where id = ${documentId}`;
  }
}

/** Saves the PDF in the file store; the row keeps its key (`library/<user>/<id>.pdf`). */
export async function storeFile(userId: string, documentId: string, data: Uint8Array) {
  const key = `library/${userId}/${documentId}.pdf`;
  await saveFile(key, data, 'application/pdf');
  return key;
}
