/**
 * Papers for the editor: search in the shape the browser reads (with BibTeX, so citing
 * never needs another lookup), keyword queries from prose, and the numbered sources
 * ([S1], [S2] ...) the AI may cite, from the papers slot and the writer's Library.
 */
import type { AuthUser } from '../auth.js';
import type { Paper, Slots } from '../slots/types.js';
import { isPagedPapersSlot, type PaperSort, type RichPaper } from '../slots/papers.js';
import { getLibraryDocuments, searchLibrary, type LibraryDocument, type LibraryHit } from './assist-store.js';
import { meterPapers } from './assist-llm.js';

const STOPWORDS = new Set(
  `a an and are as at be been being but by can could did do does for from had has have how i if in into
  is it its may might more most no not of on or our over such than that the their them then there these
  they this those through to under up was we were what when where which while who why will with would
  also however therefore thus between among within without about across after before during each other
  some many much very using used use based study studies paper results result show shows shown found
  findings research data analysis significant significantly`.split(/\s+/),
);

/** A keyword query from prose without a model call (autocomplete must stay fast). */
export function queryFromText(text: string, maxTerms = 8): string {
  const words = (text || '').replace(/\[\[CITATION_\d+\]\]/g, ' ').match(/[A-Za-z][A-Za-z-]{2,}/g) || [];
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const word of words) {
    const key = word.toLowerCase();
    if (STOPWORDS.has(key)) continue;
    if (!counts.has(key)) order.push(key);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const ranked = [...order].sort((a, b) => counts.get(b)! - counts.get(a)! || order.indexOf(a) - order.indexOf(b)).slice(0, maxTerms);
  return ranked.sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(' ');
}

// Words that say where we are in a paper, not what it is about.
const GENERIC = new Set(
  `introduction background methods method discussion conclusion conclusions literature review chapter section
  abstract summary overview aims objectives limitations implications recommendations references appendix
  practical consequences alike measurably constant even total time held particularly especially important
  remain remains remained across often still well further indicate indicates suggest suggests evidence
  effect effects role roles impact level levels`.split(/\s+/),
);

/**
 * The search for an autocomplete or AI suggest: what the document is about (its title and
 * section, weighted up) and what the writer just wrote (the last two sentences), so the papers
 * fit the sentence being continued. The first words of the text alone gave queries such as
 * "practical consequences students", which found unrelated papers.
 */
export function contextQuery(parts: { title?: string | null; section?: string | null; before: string }, maxTerms = 6): string {
  const recent = (parts.before || '').replace(/\[\[CITATION_\d+\]\]/g, ' ').slice(-600);
  const lastSentences = recent.split(/(?<=[.!?])\s+/).slice(-2).join(' ');
  const score = new Map<string, number>();
  const order: string[] = [];
  const add = (text: string, weight: number) => {
    for (const word of (text || '').match(/[A-Za-z][A-Za-z-]{2,}/g) || []) {
      const key = word.toLowerCase();
      if (STOPWORDS.has(key) || GENERIC.has(key) || /^untitled$/.test(key)) continue;
      if (!score.has(key)) order.push(key);
      score.set(key, (score.get(key) || 0) + weight);
    }
  };
  add(parts.title || '', 3);
  add(parts.section || '', 2);
  add(lastSentences, 2);
  add(recent, 1);
  const ranked = [...order].sort((a, b) => score.get(b)! - score.get(a)! || order.indexOf(a) - order.indexOf(b)).slice(0, maxTerms);
  return ranked.sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(' ');
}

/** True when a paper shares at least `min` of the query's words (by stem) in its title or abstract. */
export function sharesTopic(query: string, paper: { title?: string | null; abstract?: string | null }, min = 2): boolean {
  const stems = new Set(query.split(/\s+/).filter(Boolean).map((word) => word.slice(0, 5)));
  const words = new Set(`${paper.title || ''} ${paper.abstract || ''}`.toLowerCase().match(/[a-z][a-z-]{2,}/g)?.map((word) => word.slice(0, 5)) || []);
  let shared = 0;
  stems.forEach((stem) => { if (words.has(stem)) shared += 1; });
  return shared >= Math.min(min, stems.size);
}

// ------------------------------------------------------------------ BibTeX

// Particles that belong to the surname: "Hans P. A. Van Dongen" is Van Dongen, not Dongen.
const NAME_PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'del', 'della', 'di', 'da', 'du', 'la', 'le', 'dos', 'das', 'ter', 'ten', 'bin', 'ibn']);

export function authorLastFirst(name: string): string {
  const value = (name || '').trim();
  if (!value || value.includes(',')) return value;
  const parts = value.split(/\s+/);
  if (parts.length < 2) return value;
  let start = parts.length - 1;
  while (start > 1 && NAME_PARTICLES.has(parts[start - 1].toLowerCase())) start -= 1;
  return `${parts.slice(start).join(' ')}, ${parts.slice(0, start).join(' ')}`;
}

const bibtexClean = (value: unknown) => String(value ?? '').replace(/\\/g, '').replace(/[{}]/g, '').trim();

/** BibTeX for a paper, so citing never depends on another lookup. */
export function paperBibtex(paper: {
  title?: string | null;
  authors?: ({ name?: string } | string)[];
  year?: number | string | null;
  publication_date?: string | null;
  type?: string | null;
  doi?: string | null;
  source_name?: string | null;
  volume?: string | null;
  issue?: string | null;
  first_page?: string | null;
  last_page?: string | null;
  oa_url?: string | null;
}): string {
  const authors = (paper.authors || []).map((author) => (typeof author === 'string' ? author : author?.name || '')).filter((name) => name && name !== 'Unknown');
  const year = String(paper.year || (paper.publication_date || '').slice(0, 4) || '').trim();
  const title = bibtexClean(paper.title);
  const firstWord = (title.match(/[A-Za-z]+/g) || []).find((word) => !STOPWORDS.has(word.toLowerCase())) || 'paper';
  const lastName = authors.length ? authors[0].trim().split(/\s+/).pop() || '' : 'anon';
  const last = lastName.replace(/[^A-Za-z]/g, '') || 'anon';
  const key = `${last.toLowerCase()}${year || 'nd'}${firstWord.toLowerCase()}`;
  const kind = ({ book: 'book', 'book-chapter': 'incollection', dissertation: 'phdthesis' } as Record<string, string>)[paper.type || ''] || 'article';
  const doi = (paper.doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  const fields: [string, string][] = [
    ['author', authors.map(authorLastFirst).join(' and ')],
    ['title', title],
    [kind === 'article' ? 'journal' : 'booktitle', bibtexClean(paper.source_name)],
    ['year', year],
    ['volume', bibtexClean(paper.volume)],
    ['number', bibtexClean(paper.issue)],
    // One value for article numbers ("e16905"), not "e16905--e16905" (Chicago cannot shorten it).
    ['pages', [...new Set([bibtexClean(paper.first_page), bibtexClean(paper.last_page)].filter(Boolean))].join('--')],
    ['doi', doi],
    ['url', paper.oa_url || (doi ? `https://doi.org/${doi}` : '')],
  ];
  const body = fields.filter(([, value]) => value).map(([name, value]) => `  ${name} = {${value}}`).join(',\n');
  return `@${kind}{${key},\n${body}\n}`;
}

const escapeLibraryBibtex = (value: unknown) => String(value).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').trim();

export function libraryAuthors(doc: LibraryDocument): string[] {
  const metadata = (doc.metadata || {}) as Record<string, any>;
  const raw = (Array.isArray(doc.authors) && doc.authors.length ? doc.authors : null) ?? metadata.authors ?? metadata.author ?? [];
  const list = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
  return list.map((author: any) => String(typeof author === 'object' && author ? author.name ?? author.display_name ?? '' : author).trim()).filter(Boolean);
}

export function libraryYear(doc: LibraryDocument): string | null {
  const metadata = (doc.metadata || {}) as Record<string, any>;
  const match = /\d{4}/.exec(String(doc.publication_date || metadata.year || metadata.publication_date || ''));
  return match ? match[0] : null;
}

/** Citation metadata strictly from the writer's Library record; null when it lacks authors or year. */
export function libraryBibtex(doc: LibraryDocument): string | null {
  const metadata = (doc.metadata || {}) as Record<string, any>;
  const stored = metadata.bibtex ?? metadata.citation_bibtex;
  if (typeof stored === 'string' && stored.trim().startsWith('@')) return stored.trim();
  const title = doc.title || metadata.title || doc.filename;
  const authors = libraryAuthors(doc);
  const year = libraryYear(doc);
  if (!title || !authors.length || !year) return null;
  const doi = doc.doi || metadata.doi;
  const url = metadata.source_url || metadata.original_url;
  const kind = doi || /article/i.test(String(metadata.item_type || '')) ? 'article' : 'misc';
  const fields: [string, unknown][] = [['title', title], ['author', authors.join(' and ')], ['year', year]];
  if (doi) fields.push(['doi', doi]);
  if (doc.publisher || metadata.publisher) fields.push(['publisher', doc.publisher || metadata.publisher]);
  if (url) fields.push(['url', url]);
  const body = fields.map(([name, value]) => `  ${name} = {${escapeLibraryBibtex(value)}}`).join(',\n');
  return `@${kind}{library_${doc.id.replace(/-/g, '').slice(0, 16)},\n${body}\n}`;
}

// ------------------------------------------------------------------ search

/** A paper as the browser's assistApi `Paper` type reads it. */
export type BrowserPaper = {
  id: string;
  title: string;
  authors: { name: string; id?: string; institution?: string | null }[];
  extra_author_count: number;
  year: number | null;
  publication_date: string | null;
  doi: string | null;
  cited_by_count: number;
  is_open_access: boolean;
  oa_status: string | null;
  oa_url: string | null;
  pdf_url: string | null;
  abstract: string | null;
  source_name: string | null;
  type: string;
  volume: string | null;
  issue: string | null;
  first_page: string | null;
  last_page: string | null;
  bibtex: string;
  source_type: string;
};

export function toBrowserPaper(paper: Paper): BrowserPaper {
  const rich = paper as RichPaper;
  const result: Omit<BrowserPaper, 'bibtex'> = {
    id: paper.id,
    title: paper.title,
    authors: (paper.authors || []).map((author) => {
      const full = author as RichPaper['authors'][number];
      return { name: full.name, ...(full.id ? { id: full.id } : {}), ...(full.institution !== undefined ? { institution: full.institution } : {}) };
    }),
    extra_author_count: rich.extra_author_count ?? 0,
    year: paper.year,
    publication_date: rich.publication_date ?? null,
    doi: paper.doi,
    cited_by_count: paper.cited_by_count ?? 0,
    is_open_access: paper.is_oa,
    oa_status: rich.oa_status ?? null,
    oa_url: paper.oa_url,
    pdf_url: paper.pdf_url,
    abstract: paper.abstract,
    source_name: paper.venue,
    type: paper.type || 'article',
    volume: rich.volume ?? null,
    issue: rich.issue ?? null,
    first_page: rich.first_page ?? null,
    last_page: rich.last_page ?? null,
    source_type: 'scholar',
  };
  return { ...result, bibtex: paperBibtex(result) };
}

/** Drops duplicates (same title and year); for relevance, blends in citations. */
export function rankPapers<T extends { title: string; year: number | null; cited_by_count?: number | null }>(papers: T[], rerank: boolean): T[] {
  const seen = new Set<string>();
  const unique = papers.filter((paper) => {
    const key = `${(paper.title || '').toLowerCase().replace(/\W+/g, ' ').trim()}|${paper.year ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!rerank) return unique;
  // Relevance alone ranks uncited exact-title matches first.
  return unique
    .map((paper, position) => ({ paper, score: Math.log10(1 + (paper.cited_by_count || 0)) - 0.12 * position }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.paper);
}

export type EditorSearch = {
  query: string;
  page?: number;
  perPage?: number;
  yearFrom?: number | null;
  yearTo?: number | null;
  minCited?: number | null;
  openAccess?: boolean | null;
  sort?: PaperSort;
};

export async function searchEditorPapers(slots: Slots, user: AuthUser, search: EditorSearch): Promise<{ results: BrowserPaper[]; total: number; page: number }> {
  const query = (search.query || '').trim().slice(0, 300);
  const page = search.page ?? 1;
  const perPage = search.perPage ?? 10;
  const sort = search.sort ?? 'relevance';
  const rerank = sort === 'relevance';
  // Fetch more for relevance, then blend in citations.
  const fetchCount = rerank ? Math.min(Math.max(perPage * 2, 20), 25) : perPage;
  const input = {
    query,
    limit: fetchCount,
    page,
    sort,
    fromYear: search.yearFrom ?? undefined,
    toYear: search.yearTo ?? undefined,
    openAccess: search.openAccess ?? undefined,
    minCitations: search.minCited ?? undefined,
  };
  let papers: Paper[];
  let total: number;
  if (isPagedPapersSlot(slots.papers)) {
    ({ results: papers, total } = await slots.papers.searchPage(input));
  } else {
    papers = await slots.papers.search(input);
    total = papers.length;
    if (sort === 'cited') papers = [...papers].sort((a, b) => (b.cited_by_count || 0) - (a.cited_by_count || 0));
    if (sort === 'newest') papers = [...papers].sort((a, b) => (b.year || 0) - (a.year || 0));
  }
  await meterPapers(user, { feature: 'paper-search', provider: slots.papers.provider });
  return { results: rankPapers(papers.map(toBrowserPaper), rerank).slice(0, perPage), total, page };
}

// ------------------------------------------------------------------ numbered sources for the AI

/** A source the AI may cite as [S<n>] (the browser's AssistSource). */
export type AssistSource = {
  n: number;
  marker: string;
  title: string;
  authors: string[];
  year: number | string | null;
  doi: string | null;
  url: string | null;
  venue: string | null;
  abstract: string;
  evidence: string[];
  bibtex: string;
  source_type: string;
  library_document_id: string | null;
  cited_by_count: number | null;
  is_open_access: boolean | null;
};

type SourceCandidate = Omit<AssistSource, 'n' | 'marker'>;

function paperSource(paper: BrowserPaper): SourceCandidate {
  const doi = paper.doi;
  return {
    title: paper.title || 'Untitled',
    authors: paper.authors.map((author) => author.name).slice(0, 6),
    year: paper.year,
    doi,
    url: paper.oa_url || (doi ? (doi.startsWith('http') ? doi : `https://doi.org/${doi}`) : null),
    venue: paper.source_name,
    abstract: (paper.abstract || '').slice(0, 900),
    evidence: [],
    bibtex: paper.bibtex,
    source_type: paper.source_type || 'scholar',
    library_document_id: null,
    cited_by_count: paper.cited_by_count,
    is_open_access: paper.is_open_access,
  };
}

function librarySource(hit: LibraryHit): SourceCandidate {
  const doc = hit.document;
  const metadata = (doc.metadata || {}) as Record<string, any>;
  const doi = doc.doi || metadata.doi || null;
  return {
    title: doc.title || metadata.title || doc.filename || 'Untitled',
    authors: libraryAuthors(doc).slice(0, 6),
    year: libraryYear(doc),
    doi,
    url: metadata.source_url || metadata.original_url || (doi ? `https://doi.org/${doi}` : null),
    venue: doc.publisher || metadata.journal || null,
    abstract: (doc.abstract || '').slice(0, 900),
    evidence: hit.passages.slice(0, 2).map((passage) => passage.content.slice(0, 700)),
    // Without authors and year the item cannot become a proper citation; it still informs the answer.
    bibtex: libraryBibtex(doc) || '',
    source_type: 'library',
    library_document_id: doc.id,
    cited_by_count: null,
    is_open_access: null,
  };
}

/** Library passages for a query; chosen documents without a matching passage still count by title and abstract. */
async function libraryHits(userId: string, query: string, documentIds: string[], limit: number): Promise<LibraryHit[]> {
  const ids = [...new Set(documentIds)];
  const hits = await searchLibrary(userId, query, ids, limit);
  if (hits.length || !ids.length) return hits;
  const terms = new Set((query.toLowerCase().match(/[\p{L}\p{N}-]{3,}/gu) || []));
  const score = (doc: LibraryDocument) => {
    const text = `${doc.title || ''} ${doc.abstract || ''}`.toLowerCase();
    let total = 0;
    for (const term of terms) total += text.split(term).length - 1;
    return total;
  };
  const documents = await getLibraryDocuments(userId, ids);
  return documents
    .map((document) => ({ document, score: score(document) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ document }) => ({ document, passages: [] }));
}

/** Numbered sources (web = the papers slot, library = the writer's own papers). */
export async function gatherSources(
  slots: Slots,
  user: AuthUser,
  options: { query: string; useWeb: boolean; useLibrary: boolean; libraryDocumentIds: string[]; limit?: number; filters?: { yearFrom?: number | null; minCited?: number | null; preprints?: boolean } },
): Promise<AssistSource[]> {
  const limit = options.limit ?? 6;
  const tasks: Promise<SourceCandidate[]>[] = [];
  if (options.useWeb && options.query.trim()) {
    tasks.push(
      searchEditorPapers(slots, user, { query: options.query, perPage: limit, yearFrom: options.filters?.yearFrom ?? null, minCited: options.filters?.minCited ?? null })
        // "Include preprints" off: only peer-reviewed work.
        .then((result) => result.results.filter((paper) => options.filters?.preprints !== false || !/preprint|posted-content/i.test(paper.type || '')).map(paperSource)),
    );
  }
  if (options.useLibrary) {
    tasks.push(libraryHits(user.id, options.query, options.libraryDocumentIds, limit).then((hits) => hits.map(librarySource)));
  }
  const settled = await Promise.allSettled(tasks);
  const candidates: SourceCandidate[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') candidates.push(...result.value);
    else console.warn('editor source search failed:', (result.reason as Error)?.message || result.reason);
  }
  return candidates.slice(0, limit * 2).map((source, index) => ({ n: index + 1, marker: `S${index + 1}`, ...source }));
}

/** The sources an answer actually cites with [S1] / [S1, S3] markers. */
export function usedSources<T extends { n: number }>(text: string, sources: T[]): T[] {
  const groups = [...(text || '').matchAll(/\[(S\d+(?:\s*[,;]\s*S?\d+)*)\]/g)].map((match) => match[1]).join(' ');
  const used = new Set([...groups.matchAll(/S(\d+)/g)].map((match) => Number(match[1])));
  return sources.filter((source) => used.has(source.n));
}

/**
 * Drops citation markers the model made up: [[CITATION_n]] placeholders that are not in the
 * writer's text, and [Sn] markers for sources it was not given (kept ones stay in place).
 */
export function dropInventedMarkers(text: string, sources: { n: number }[], writerText: string): string {
  const known = new Set(sources.map((source) => source.n));
  return (text || '')
    .replace(/\s*\[\[CITATION_\d+\]\]/g, (marker) => (writerText.includes(marker.trim()) ? marker : ''))
    .replace(/(\s*)\[(S\d+(?:\s*[,;]\s*S?\d+)*)\]/g, (marker, space: string, group: string) => {
      const ids = [...group.matchAll(/S?(\d+)/g)].map((match) => Number(match[1]));
      const valid = ids.filter((id) => known.has(id));
      if (valid.length === ids.length) return marker;
      return valid.length ? `${space}[${valid.map((id) => `S${id}`).join(', ')}]` : '';
    });
}

/** Resolves after `ms` with `fallback` unless the work finishes first. */
export function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([work.catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}
