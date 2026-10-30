import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireUser, type AppVariables } from '../auth.js';
import type { Slots } from '../slots/types.js';
import { isPagedPapersSlot, workToPaper, type RichPaper } from '../slots/papers.js';
import { settings } from '../lib/settings.js';
import { libraryLimits } from '../lib/plans.js';
import { parseBibtex, parseIds, parseRis, type PastedId, type ReferenceItem } from '../lib/referenceFiles.js';
import { importJob, isImporting, runImport, startImportJob, type ImportEntry } from '../lib/libraryImport.js';

/** Most items one file or paste may bring in (larger libraries: Zotero or Mendeley sync). */
const MAX_ITEMS = 2000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const shortId = (value: string) => value.replace(/^https?:\/\/openalex\.org\//i, '');

/** Public OpenAlex for identifiers the papers index does not resolve (PubMed ids, arXiv DOIs, very new DOIs). */
async function openAlexWork(id: string): Promise<RichPaper | null> {
  const mailto = settings().openalexEmail;
  const response = await fetch(`https://api.openalex.org/works/${id}${mailto ? `?mailto=${encodeURIComponent(mailto)}` : ''}`, {
    headers: { 'User-Agent': 'Videmak/0.1 (+https://videmak.net)' }, signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const work: any = response?.ok ? await response.json().catch(() => null) : null;
  return work?.id ? workToPaper(work) : null;
}

function paperEntry(paper: RichPaper, externalId: string | null): ImportEntry {
  return {
    title: paper.title,
    authors: paper.authors.map((author) => author.name),
    year: paper.year ? String(paper.year) : null,
    doi: paper.doi,
    journal: paper.venue,
    url: paper.doi ? `https://doi.org/${paper.doi}` : paper.oa_url,
    abstract: paper.abstract,
    externalId,
    metadata: { scholar_id: shortId(paper.id) },
    workId: shortId(paper.id),
    pdfUrl: paper.pdf_url,
  };
}

/** Folder ids come from the browser: only the person's own folders are used. */
async function ownFolder(userId: string, folderId: unknown) {
  if (typeof folderId !== 'string' || !folderId) return null;
  const [row] = await sql`select id from library_folders where id = ${folderId} and user_id = ${userId}`;
  if (!row) throw new HTTPException(404, { message: 'That collection was not found.' });
  return folderId;
}

export function libraryImportRoutes(slots: Slots) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', requireUser);

  /** What the add dialog may do on this plan. */
  app.get('/limits', async (c) => {
    const user = c.get('user')!;
    return c.json(await libraryLimits(user.account_id, user.id));
  });

  app.get('/import/jobs/:id', async (c) => {
    const job = await importJob(c.get('user')!.id, c.req.param('id'));
    if (!job) throw new HTTPException(404, { message: 'Import not found.' });
    return c.json(job);
  });

  const busy = (userId: string) => {
    if (isImporting(userId)) throw new HTTPException(409, { message: 'An import is already running. It will finish in a moment.' });
  };

  /** Turns an item from a file into an import entry; with PDFs on, its DOI finds Scholar's copy. */
  const fromReference = async (item: ReferenceItem, source: 'bibtex' | 'ris', findPdfs: boolean): Promise<ImportEntry> => {
    let workId: string | null = null;
    let pdfUrl: string | null = null;
    if (findPdfs && item.doi) {
      const paper = await slots.papers.lookupDoi(item.doi).catch(() => null) as RichPaper | null;
      if (paper) { workId = shortId(paper.id); pdfUrl = paper.pdf_url; }
    }
    return {
      ...item,
      externalId: null,
      metadata: { bibtex: item.bibtex, citation_key: item.key, ...(workId ? { scholar_id: workId } : {}) },
      workId, pdfUrl,
    };
  };

  /** A .bib or .ris file: every entry becomes a reference (and a PDF when one is found). */
  app.post('/import/file', async (c) => {
    const user = c.get('user')!;
    busy(user.id);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw new HTTPException(422, { message: 'Choose a .bib or .ris file.' });
    if (file.size > MAX_FILE_BYTES) throw new HTTPException(413, { message: 'Reference files can be up to 10 MB.' });
    const text = await file.text();
    const looksRis = /\.ris$/i.test(file.name) || /^TY {2}- /m.test(text);
    const items = (looksRis ? parseRis(text) : parseBibtex(text)).slice(0, MAX_ITEMS);
    if (!items.length) throw new HTTPException(422, { message: `No references found in ${file.name}. Use a BibTeX (.bib) or RIS (.ris) file.` });
    const folderId = await ownFolder(user.id, form?.get('folder_id'));
    const findPdfs = form?.get('find_pdfs') !== 'false';
    const source = looksRis ? 'ris' : 'bibtex';
    const jobId = await startImportJob(user.id, source, file.name);
    async function* entries() { for (const item of items) yield fromReference(item, source, findPdfs); }
    void runImport(jobId, user, entries(), { folderId, source, findPdfs, total: items.length });
    return c.json({ job_id: jobId, total: items.length }, 202);
  });

  /** Pasted DOIs, PubMed ids and arXiv ids, looked up in the papers index. */
  app.post('/import/ids', async (c) => {
    const user = c.get('user')!;
    busy(user.id);
    const body = z.object({ text: z.string().max(200_000), folder_id: z.string().nullable().optional(), find_pdfs: z.boolean().default(true) })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new HTTPException(422, { message: 'Paste DOIs, PubMed ids or arXiv ids.' });
    const ids = parseIds(body.data.text).slice(0, 500);
    if (!ids.length) throw new HTTPException(422, { message: 'No DOI, PubMed id or arXiv id found. Paste one per line, like 10.1038/nrn2762.' });
    const folderId = await ownFolder(user.id, body.data.folder_id);
    const lookup = async (id: PastedId): Promise<RichPaper | null> => {
      const doi = id.kind === 'doi' ? id.value : id.kind === 'arxiv' ? `10.48550/arXiv.${id.value}` : null;
      const found = doi
        ? ((await slots.papers.lookupDoi(doi).catch(() => null)) as RichPaper | null)
        : isPagedPapersSlot(slots.papers) ? await slots.papers.lookupPmid(id.value).catch(() => null) : null;
      return found ?? openAlexWork(doi ? `doi:${doi}` : `pmid:${id.value}`);
    };
    const jobId = await startImportJob(user.id, 'ids', `${ids.length} identifier${ids.length === 1 ? '' : 's'}`);
    async function* entries() {
      for (const id of ids) {
        const paper = await lookup(id);
        yield paper ? paperEntry(paper, null) : null;
      }
    }
    void runImport(jobId, user, entries(), { folderId, source: 'ids', findPdfs: body.data.find_pdfs, total: ids.length });
    return c.json({ job_id: jobId, total: ids.length }, 202);
  });

  return app;
}
