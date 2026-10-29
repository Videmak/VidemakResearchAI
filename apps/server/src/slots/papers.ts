/**
 * The papers slot: scholarly search over an OpenAlex-compatible API. Providers:
 * `scholar` (CitedEvidence Scholar's /v1/oa API, the default), `videmak` (Videmak Cloud,
 * same shape) and `openalex` (public api.openalex.org). When Scholar or Videmak Cloud is busy, a search
 * falls back to public OpenAlex, which takes the same parameters.
 */
import { env } from '../env.js';
import type { Paper, PapersSlot } from './types.js';

export type PapersProvider = 'openalex' | 'scholar' | 'videmak';

/** A Paper plus the details OpenAlex gives that the editor shows or puts in BibTeX. */
export type RichPaper = Paper & {
  /** OpenAlex marks retracted works. */
  is_retracted?: boolean;
  authors: { name: string; id?: string; institution?: string | null }[];
  extra_author_count?: number;
  publication_date?: string | null;
  oa_status?: string | null;
  volume?: string | null;
  issue?: string | null;
  first_page?: string | null;
  last_page?: string | null;
};

export type PaperSort = 'relevance' | 'cited' | 'newest';

export type PaperSearchInput = Parameters<PapersSlot['search']>[0] & { page?: number; sort?: PaperSort };

/** Our slots also page, report totals and look papers up by OpenAlex work id. */
export interface PagedPapersSlot extends PapersSlot {
  searchPage(input: PaperSearchInput): Promise<{ results: RichPaper[]; total: number }>;
  lookupWork(workId: string): Promise<RichPaper | null>;
}

export class PapersError extends Error {
  readonly status: 503;
  readonly code: 'not_configured' | 'busy';
  constructor(code: PapersError['code'], message: string) {
    super(message);
    this.name = 'PapersError';
    this.code = code;
    this.status = 503;
  }
}

export type PapersSettings = Pick<typeof env, 'papersProvider' | 'videmakApiKey' | 'videmakApiUrl' | 'scholarUrl' | 'scholarApiKey' | 'openalexEmail'>;

type Endpoint = { provider: string; base: string; headers: Record<string, string>; params: Record<string, string>; unavailable: string | null };

const OPENALEX_BASE = 'https://api.openalex.org';
const USER_AGENT = 'Videmak/0.1 (+https://videmak.net)';

function openalexEndpoint(settings: PapersSettings): Endpoint {
  return {
    provider: 'openalex',
    base: OPENALEX_BASE,
    headers: { 'User-Agent': `${USER_AGENT} mailto:${settings.openalexEmail}` },
    params: settings.openalexEmail ? { mailto: settings.openalexEmail } : {},
    unavailable: null,
  };
}

/** Which provider and endpoint the settings select. Pure, for tests. */
export function resolvePapersEndpoint(settings: PapersSettings = env): Endpoint {
  const requested = settings.papersProvider.toLowerCase();
  // Scholar is the default: it answers without a key too (lower limits), and OpenAlex covers when it is busy.
  const provider = requested || (settings.videmakApiKey && !settings.scholarApiKey ? 'videmak' : 'scholar');
  if (provider === 'videmak') {
    return {
      provider,
      base: `${settings.videmakApiUrl}/v1/oa`,
      headers: { 'User-Agent': USER_AGENT, ...(settings.videmakApiKey ? { Authorization: `Bearer ${settings.videmakApiKey}` } : {}) },
      params: {},
      unavailable: settings.videmakApiKey ? null : 'Paper search is not configured: set VIDEMAK_API_KEY or PAPERS_PROVIDER=openalex',
    };
  }
  if (provider === 'scholar') {
    // Bearer key when there is one, mailto always.
    return {
      provider,
      base: `${settings.scholarUrl}/v1/oa`,
      headers: { 'User-Agent': USER_AGENT, ...(settings.scholarApiKey ? { Authorization: `Bearer ${settings.scholarApiKey}` } : {}) },
      params: settings.openalexEmail ? { mailto: settings.openalexEmail } : {},
      unavailable: null,
    };
  }
  if (provider === 'openalex') return openalexEndpoint(settings);
  return { ...openalexEndpoint(settings), provider, unavailable: `Paper search is not configured: unknown PAPERS_PROVIDER "${provider}" (use openalex, scholar or videmak)` };
}

// ------------------------------------------------------------------ query and filters

/** Characters Scholar's query syntax reads as fields, regexes or boosts; left in they can hang a search. */
const QUERY_NOISE = /[\\/:[\]{}^~!?<>=|&]/g;

export function cleanQuery(query: string): string {
  let text = (query || '').replace(QUERY_NOISE, ' ');
  if ((text.match(/"/g) || []).length % 2) text = text.replace(/"/g, ' ');
  return text.split(/\s+/).filter(Boolean).join(' ').slice(0, 300).trim();
}

export function searchParams(input: PaperSearchInput, perPage: number): Record<string, string> {
  const filters: string[] = [];
  if (input.fromYear) filters.push(`from_publication_date:${input.fromYear}-01-01`);
  if (input.toYear) filters.push(`to_publication_date:${input.toYear}-12-31`);
  if (input.openAccess) filters.push('open_access.is_oa:true');
  // "At least N citations"; the API's filter is strictly greater-than.
  if (input.minCitations && input.minCitations > 0) filters.push(`cited_by_count:>${input.minCitations - 1}`);
  const params: Record<string, string> = { search: cleanQuery(input.query), per_page: String(perPage), page: String(Math.max(1, input.page ?? 1)) };
  if (filters.length) params.filter = filters.join(',');
  const sort = input.sort === 'cited' ? 'cited_by_count:desc' : input.sort === 'newest' ? 'publication_date:desc' : null;
  if (sort) params.sort = sort;
  return params;
}

// ------------------------------------------------------------------ mapping

const shortId = (value: unknown) => String(value ?? '').replace(/^https?:\/\/openalex\.org\//i, '');

export function cleanDoi(value: unknown): string | null {
  const doi = String(value ?? '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, '');
  return doi || null;
}

/** OpenAlex keeps abstracts as {word: [positions]}; put the words back in order. */
export function reconstructAbstract(index: unknown): string | null {
  if (!index || typeof index !== 'object') return null;
  const words: [number, string][] = [];
  for (const [word, positions] of Object.entries(index as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) if (typeof position === 'number') words.push([position, word]);
  }
  if (!words.length) return null;
  words.sort((a, b) => a[0] - b[0]);
  return words.map(([, word]) => word).join(' ');
}

const text = (value: unknown) => (value === null || value === undefined || value === '' ? null : String(value));

export function workToPaper(work: any): RichPaper {
  const authorships: any[] = Array.isArray(work?.authorships) ? work.authorships : [];
  const primary = work?.primary_location || {};
  const best = work?.best_oa_location || {};
  const openAccess = work?.open_access || {};
  const biblio = work?.biblio || {};
  const date = text(work?.publication_date);
  const year = Number.isInteger(work?.publication_year) ? work.publication_year : date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;
  const locations: any[] = Array.isArray(work?.locations) ? work.locations : [];
  const pdfUrl = best.pdf_url || (primary.is_oa ? primary.pdf_url : null) || locations.find((location) => location?.is_oa && location?.pdf_url)?.pdf_url || null;
  return {
    id: shortId(work?.id),
    title: String(work?.title || work?.display_name || 'Untitled'),
    authors: authorships.slice(0, 5).map((authorship) => ({
      name: String(authorship?.author?.display_name || authorship?.raw_author_name || 'Unknown'),
      id: shortId(authorship?.author?.id) || undefined,
      institution: authorship?.institutions?.[0]?.display_name ?? null,
    })),
    extra_author_count: Math.max(0, authorships.length - 5),
    year,
    publication_date: date,
    venue: text(primary?.source?.display_name) ?? text(best?.source?.display_name),
    doi: cleanDoi(work?.doi),
    abstract: text(work?.abstract) ?? reconstructAbstract(work?.abstract_inverted_index),
    cited_by_count: typeof work?.cited_by_count === 'number' ? work.cited_by_count : 0,
    is_oa: Boolean(openAccess.is_oa ?? best.is_oa ?? false),
    oa_url: text(openAccess.oa_url) ?? text(best.landing_page_url) ?? text(pdfUrl),
    pdf_url: text(pdfUrl),
    type: text(work?.type),
    is_retracted: Boolean(work?.is_retracted),
    oa_status: text(openAccess.oa_status),
    volume: text(biblio.volume),
    issue: text(biblio.issue),
    first_page: text(biblio.first_page),
    last_page: text(biblio.last_page),
  };
}

// ------------------------------------------------------------------ HTTP

class TtlLru<V> {
  private items = new Map<string, { value: V; expires: number }>();
  constructor(private max: number, private ttlMs: number) {}
  get(key: string): V | undefined {
    const hit = this.items.get(key);
    if (!hit) return undefined;
    this.items.delete(key);
    if (hit.expires < Date.now()) return undefined;
    this.items.set(key, hit);
    return hit.value;
  }
  set(key: string, value: V) {
    this.items.delete(key);
    this.items.set(key, { value, expires: Date.now() + this.ttlMs });
    while (this.items.size > this.max) this.items.delete(this.items.keys().next().value as string);
  }
}

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const TIMEOUT_MS = 8_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const retryable = (status: number) => status === 429 || status >= 500;

export function createPapersSlot(options: { settings?: PapersSettings; fetch?: typeof fetch; retryDelayMs?: number } = {}): PagedPapersSlot {
  const settings = options.settings ?? env;
  const endpoint = resolvePapersEndpoint(settings);
  const fallback = endpoint.provider === 'openalex' ? null : openalexEndpoint(settings);
  const doFetch = options.fetch ?? fetch;
  const retryDelay = options.retryDelayMs ?? 600;
  const cache = new TtlLru<unknown>(300, 5 * 60_000);

  /** GET JSON with an 8 s timeout and one retry on 429/5xx; 404 -> null. */
  async function getJson(target: Endpoint, path: string, params: Record<string, string>): Promise<any | null> {
    const url = new URL(`${target.base}/${path}`);
    for (const [key, value] of Object.entries({ ...params, ...target.params })) url.searchParams.set(key, value);
    const key = `${target.provider} ${url}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await doFetch(url, { headers: { Accept: 'application/json', ...target.headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        if (attempt === 0 && !timedOut) {
          await sleep(retryDelay);
          continue;
        }
        throw error;
      }
      if (response.status === 404) {
        cache.set(key, null);
        return null;
      }
      if (response.ok) {
        const data = await response.json();
        cache.set(key, data);
        return data;
      }
      if (attempt === 0 && retryable(response.status)) {
        const after = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 2000) : retryDelay);
        continue;
      }
      throw new HttpStatusError(response.status);
    }
  }

  /** The configured provider first; public OpenAlex when it is busy or down. */
  async function request(path: string, params: Record<string, string>): Promise<any | null> {
    if (endpoint.unavailable) throw new PapersError('not_configured', endpoint.unavailable);
    try {
      return await getJson(endpoint, path, params);
    } catch (error) {
      // A rejected query (e.g. only stopwords) is not an outage; there is nothing to find.
      if (error instanceof HttpStatusError && error.status === 400) return null;
      console.warn(`papers: ${endpoint.provider} ${path} failed (${(error as Error).message})${fallback ? '; trying public OpenAlex' : ''}`);
      if (fallback) {
        try {
          return await getJson(fallback, path, params);
        } catch (fallbackError) {
          if (fallbackError instanceof HttpStatusError && fallbackError.status === 400) return null;
          console.warn(`papers: openalex ${path} failed (${(fallbackError as Error).message})`);
        }
      }
      throw new PapersError('busy', 'Paper search is busy. Try again.');
    }
  }

  async function searchPage(input: PaperSearchInput) {
    const perPage = Math.min(Math.max(1, input.limit ?? 10), 50);
    if (!cleanQuery(input.query)) return { results: [], total: 0 };
    const data = await request('works', searchParams(input, perPage));
    const results = (Array.isArray(data?.results) ? data.results : []).map(workToPaper);
    return { results, total: Number(data?.meta?.count ?? results.length) || 0 };
  }

  return {
    provider: endpoint.provider,
    searchPage,
    async search(input) {
      return (await searchPage(input)).results;
    },
    async lookupDoi(doi) {
      const clean = cleanDoi(doi);
      if (!clean) return null;
      const data = await request(`works/doi:${encodeURI(clean).replace(/#/g, '%23').replace(/\?/g, '%3F')}`, {});
      return data && typeof data === 'object' && data.id ? workToPaper(data) : null;
    },
    async lookupWork(workId) {
      if (!/^W\d+$/.test(workId)) return null;
      const data = await request(`works/${workId}`, {});
      return data && typeof data === 'object' && data.id ? workToPaper(data) : null;
    },
  };
}

/** True for our slots (paged search, totals, work lookup); a plain PapersSlot gets fallbacks. */
export function isPagedPapersSlot(slot: PapersSlot): slot is PagedPapersSlot {
  const paged = slot as Partial<PagedPapersSlot>;
  return typeof paged.searchPage === 'function' && typeof paged.lookupWork === 'function';
}
