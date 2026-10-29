import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'test-secret-for-slot-tests-0123456789abcd';
});

import { createLlmSlot, LlmError, NOT_CONFIGURED_MESSAGE, resolveLlmConfig, type LlmSettings } from '../src/slots/llm.js';
import { cleanQuery, createPapersSlot, reconstructAbstract, resolvePapersEndpoint, workToPaper, type PapersSettings } from '../src/slots/papers.js';

const llmSettings = (overrides: Partial<LlmSettings> = {}): LlmSettings => ({
  llmProvider: '',
  llmApiKey: '',
  llmBaseUrl: '',
  llmModel: '',
  llmReviewModel: '',
  videmakApiKey: '',
  videmakApiUrl: 'https://api.videmak.net',
  publicUrl: 'http://localhost:3000',
  ...overrides,
});

const papersSettings = (overrides: Partial<PapersSettings> = {}): PapersSettings => ({
  papersProvider: '',
  videmakApiKey: '',
  videmakApiUrl: 'https://api.videmak.net',
  scholarUrl: 'https://scholar.citedevidence.com',
  scholarApiKey: '',
  openalexEmail: 'dev@example.com',
  ...overrides,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// ------------------------------------------------------------------ LLM provider selection

describe('LLM provider selection', () => {
  it('defaults to DeepSeek, and reports a missing key without throwing', () => {
    const config = resolveLlmConfig(llmSettings());
    expect(config).toMatchObject({ provider: 'deepseek', baseURL: 'https://api.deepseek.com', models: { fast: 'deepseek-chat', review: 'deepseek-chat' }, unavailable: NOT_CONFIGURED_MESSAGE });
    expect(resolveLlmConfig(llmSettings({ llmApiKey: 'sk-test' })).unavailable).toBeNull();
  });

  it('uses Videmak Cloud when a Videmak key is set', () => {
    const config = resolveLlmConfig(llmSettings({ videmakApiKey: 'vmk_test' }));
    expect(config).toMatchObject({ provider: 'videmak', baseURL: 'https://api.videmak.net/v1', apiKey: 'vmk_test', unavailable: null });
  });

  it('LLM_PROVIDER wins over the Videmak key', () => {
    const config = resolveLlmConfig(llmSettings({ videmakApiKey: 'vmk_test', llmProvider: 'openai', llmApiKey: 'sk-openai' }));
    expect(config).toMatchObject({ provider: 'openai', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-openai', tokenParam: 'max_completion_tokens' });
  });

  it('knows each provider endpoint', () => {
    expect(resolveLlmConfig(llmSettings({ llmProvider: 'anthropic', llmApiKey: 'k' })).baseURL).toBe('https://api.anthropic.com/v1');
    expect(resolveLlmConfig(llmSettings({ llmProvider: 'openrouter', llmApiKey: 'k' }))).toMatchObject({ baseURL: 'https://openrouter.ai/api/v1', headers: { 'X-Title': 'Videmak' } });
    const ollama = resolveLlmConfig(llmSettings({ llmProvider: 'ollama' }));
    expect(ollama).toMatchObject({ baseURL: 'http://localhost:11434/v1', unavailable: null });
    expect(resolveLlmConfig(llmSettings({ llmProvider: 'ollama', llmBaseUrl: 'http://gpu:11434/v1/' })).baseURL).toBe('http://gpu:11434/v1');
  });

  it('LLM_MODEL and LLM_REVIEW_MODEL override the models', () => {
    expect(resolveLlmConfig(llmSettings({ llmApiKey: 'k', llmModel: 'fast-x' })).models).toEqual({ fast: 'fast-x', review: 'fast-x' });
    expect(resolveLlmConfig(llmSettings({ llmApiKey: 'k', llmModel: 'fast-x', llmReviewModel: 'review-y' })).models).toEqual({ fast: 'fast-x', review: 'review-y' });
  });

  it('rejects an unknown provider clearly', () => {
    expect(resolveLlmConfig(llmSettings({ llmProvider: 'gemini' })).unavailable).toMatch(/unknown LLM_PROVIDER "gemini"/);
  });
});

// ------------------------------------------------------------------ LLM calls (mocked fetch)

describe('LLM slot', () => {
  it('fails each call with a clear error when no key is set', async () => {
    const slot = createLlmSlot({ settings: llmSettings() });
    await expect(slot.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({ name: 'LlmError', status: 503, message: NOT_CONFIGURED_MESSAGE });
  });

  it('returns the text and the API usage; reviews get more output room', async () => {
    const requests: any[] = [];
    const fetchMock = vi.fn(async (_url: any, init: any) => {
      requests.push(JSON.parse(init.body));
      return json({ id: 'c1', object: 'chat.completion', created: 1, model: 'deepseek-chat', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"issues": []}' } }], usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 } });
    });
    const slot = createLlmSlot({ settings: llmSettings({ llmApiKey: 'sk-test' }), fetch: fetchMock as any });
    const result = await slot.complete({ messages: [{ role: 'user', content: 'Review this' }], task: 'review', maxTokens: 2200, temperature: 0.1, json: true });
    expect(result).toEqual({ text: '{"issues": []}', usage: { inputTokens: 42, outputTokens: 7 } });
    expect(requests[0]).toMatchObject({ model: 'deepseek-chat', max_tokens: 4096, temperature: 0.1, response_format: { type: 'json_object' } });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.deepseek.com/chat/completions');
  });

  it('estimates usage (~4 characters per token) when the API leaves it out', async () => {
    const fetchMock = vi.fn(async () => json({ id: 'c1', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '12345678' } }] }));
    const slot = createLlmSlot({ settings: llmSettings({ llmApiKey: 'sk-test' }), fetch: fetchMock as any });
    const { usage } = await slot.complete({ messages: [{ role: 'user', content: 'x'.repeat(40) }] });
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 2 });
  });

  it('maps an insufficient balance answer (402) to a quota error', async () => {
    const fetchMock = vi.fn(async () => json({ error: { message: 'Insufficient Balance', type: 'unknown_error' } }, 402));
    const slot = createLlmSlot({ settings: llmSettings({ llmApiKey: 'sk-test' }), fetch: fetchMock as any });
    const error = await slot.complete({ messages: [{ role: 'user', content: 'hi' }] }).catch((caught) => caught);
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ code: 'quota', status: 402 });
  });

  it('streams deltas and reads the usage chunk', async () => {
    const chunk = (delta: object, usage?: object) => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm', choices: Object.keys(delta).length ? [{ index: 0, delta, finish_reason: null }] : [], ...(usage ? { usage } : {}) })}\n\n`;
    const body = chunk({ content: 'Hello' }) + chunk({ content: ' world' }) + chunk({}, { prompt_tokens: 12, completion_tokens: 3 }) + 'data: [DONE]\n\n';
    const requests: any[] = [];
    const fetchMock = vi.fn(async (_url: any, init: any) => {
      requests.push(JSON.parse(init.body));
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const slot = createLlmSlot({ settings: llmSettings({ videmakApiKey: 'vmk_test' }), fetch: fetchMock as any });
    const deltas: string[] = [];
    const result = await slot.stream({ messages: [{ role: 'user', content: 'hi' }] }, (delta) => deltas.push(delta));
    expect(deltas).toEqual(['Hello', ' world']);
    expect(result).toEqual({ text: 'Hello world', usage: { inputTokens: 12, outputTokens: 3 } });
    expect(requests[0]).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.videmak.net/v1/chat/completions');
    expect(fetchMock.mock.calls[0][1].headers.authorization ?? fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer vmk_test');
  });
});

// ------------------------------------------------------------------ papers

describe('papers provider selection', () => {
  it('scholar by default, videmak with only a Videmak key, PAPERS_PROVIDER wins', () => {
    expect(resolvePapersEndpoint(papersSettings())).toMatchObject({ provider: 'scholar', base: 'https://scholar.citedevidence.com/v1/oa', params: { mailto: 'dev@example.com' } });
    expect(resolvePapersEndpoint(papersSettings({ papersProvider: 'openalex' }))).toMatchObject({ provider: 'openalex', base: 'https://api.openalex.org', params: { mailto: 'dev@example.com' } });
    expect(resolvePapersEndpoint(papersSettings({ videmakApiKey: 'vmk' }))).toMatchObject({ provider: 'videmak', base: 'https://api.videmak.net/v1/oa', headers: { Authorization: 'Bearer vmk' } });
    expect(resolvePapersEndpoint(papersSettings({ videmakApiKey: 'vmk', papersProvider: 'scholar', scholarApiKey: 'sch' }))).toMatchObject({
      provider: 'scholar',
      base: 'https://scholar.citedevidence.com/v1/oa',
      headers: { Authorization: 'Bearer sch' },
    });
    expect(resolvePapersEndpoint(papersSettings({ papersProvider: 'videmak' })).unavailable).toMatch(/VIDEMAK_API_KEY/);
  });
});

const WORK = {
  id: 'https://openalex.org/W2741809807',
  doi: 'https://doi.org/10.7717/peerj.4375',
  title: 'The state of OA',
  publication_year: 2018,
  publication_date: '2018-02-13',
  type: 'article',
  cited_by_count: 900,
  authorships: Array.from({ length: 7 }, (_, index) => ({ author: { id: `https://openalex.org/A${index}`, display_name: `Author ${index}` }, institutions: index === 0 ? [{ display_name: 'Uni A' }] : [] })),
  primary_location: { is_oa: true, pdf_url: null, source: { display_name: 'PeerJ' } },
  best_oa_location: { is_oa: true, pdf_url: 'https://peerj.com/articles/4375.pdf', landing_page_url: 'https://peerj.com/articles/4375' },
  open_access: { is_oa: true, oa_status: 'gold', oa_url: 'https://peerj.com/articles/4375' },
  biblio: { volume: '6', issue: null, first_page: 'e4375', last_page: null },
  abstract_inverted_index: { Despite: [0], growing: [1], interest: [2], in: [3, 6], Open: [4], Access: [5], scholarly: [7] },
};

describe('OpenAlex mapping', () => {
  it('rebuilds the abstract from the inverted index', () => {
    expect(reconstructAbstract(WORK.abstract_inverted_index)).toBe('Despite growing interest in Open Access in scholarly');
    expect(reconstructAbstract(null)).toBeNull();
  });

  it('maps a work to a Paper', () => {
    const paper = workToPaper(WORK);
    expect(paper).toMatchObject({
      id: 'W2741809807',
      title: 'The state of OA',
      year: 2018,
      publication_date: '2018-02-13',
      venue: 'PeerJ',
      doi: '10.7717/peerj.4375',
      abstract: 'Despite growing interest in Open Access in scholarly',
      cited_by_count: 900,
      is_oa: true,
      oa_url: 'https://peerj.com/articles/4375',
      pdf_url: 'https://peerj.com/articles/4375.pdf',
      type: 'article',
      extra_author_count: 2,
      volume: '6',
      first_page: 'e4375',
    });
    expect(paper.authors).toHaveLength(5);
    expect(paper.authors[0]).toEqual({ name: 'Author 0', id: 'A0', institution: 'Uni A' });
  });

  it('cleans query syntax Scholar chokes on', () => {
    expect(cleanQuery('diabetes/obesity: "risk? factors')).toBe('diabetes obesity risk factors');
  });
});

describe('papers slot HTTP', () => {
  it('sends filters, reads totals and caches identical queries', async () => {
    const fetchMock = vi.fn(async (_url: URL) => json({ meta: { count: 77 }, results: [WORK] }));
    const slot = createPapersSlot({ settings: papersSettings({ papersProvider: 'openalex' }), fetch: fetchMock as any });
    const input = { query: 'open access', limit: 5, fromYear: 2010, toYear: 2020, openAccess: true, minCitations: 100, sort: 'newest' as const };
    const page = await slot.searchPage(input);
    expect(page.total).toBe(77);
    expect(page.results[0].id).toBe('W2741809807');
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.origin + url.pathname).toBe('https://api.openalex.org/works');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      search: 'open access',
      per_page: '5',
      page: '1',
      filter: 'from_publication_date:2010-01-01,to_publication_date:2020-12-31,open_access.is_oa:true,cited_by_count:>99',
      sort: 'publication_date:desc',
      mailto: 'dev@example.com',
    });
    await slot.search(input);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on 429', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({ meta: { count: 1 }, results: [WORK] }));
    const slot = createPapersSlot({ settings: papersSettings(), fetch: fetchMock as any, retryDelayMs: 0 });
    expect(await slot.search({ query: 'oa' })).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back from a busy Scholar to public OpenAlex', async () => {
    const hosts: string[] = [];
    const fetchMock = vi.fn(async (url: URL, init: any) => {
      hosts.push(url.host);
      if (url.host === 'scholar.citedevidence.com') {
        expect(init.headers.Authorization).toBe('Bearer sch');
        return json({ error: 'busy' }, 503);
      }
      return json({ meta: { count: 1 }, results: [WORK] });
    });
    const slot = createPapersSlot({ settings: papersSettings({ papersProvider: 'scholar', scholarApiKey: 'sch' }), fetch: fetchMock as any, retryDelayMs: 0 });
    expect(await slot.search({ query: 'oa' })).toHaveLength(1);
    expect(hosts).toEqual(['scholar.citedevidence.com', 'scholar.citedevidence.com', 'api.openalex.org']);
  });

  it('looks a DOI up; 404 is null', async () => {
    const fetchMock = vi.fn(async (url: URL) => (url.pathname.includes('peerj') ? json(WORK) : json({ error: 'not found' }, 404)));
    const slot = createPapersSlot({ settings: papersSettings({ papersProvider: 'openalex' }), fetch: fetchMock as any });
    expect((await slot.lookupDoi('https://doi.org/10.7717/peerj.4375'))?.title).toBe('The state of OA');
    expect((fetchMock.mock.calls[0][0] as URL).pathname).toBe('/works/doi:10.7717/peerj.4375');
    expect(await slot.lookupDoi('10.1/missing')).toBeNull();
  });
});
