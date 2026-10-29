import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'test-secret-for-assist-routes-0123456789';
  return {
    threads: new Map<string, any>(),
    library: [] as any[],
    libraryDocs: [] as any[],
    usage: [] as any[],
  };
});

vi.mock('../src/usage.js', () => ({
  recordUsage: vi.fn(async (event: any) => {
    state.usage.push(event);
  }),
}));

// Plan allowances have their own tests (plans.test.ts); here every request is allowed.
vi.mock('../src/lib/plans.js', async () => {
  const { createMiddleware } = await import('hono/factory');
  return { planQuota: () => createMiddleware(async (_c, next) => next()) };
});
vi.mock('../src/lib/access.js', async () => {
  const { HTTPException } = await import('hono/http-exception');
  return {
    EDIT_ROLES: ['owner', 'editor'],
    COMMENT_ROLES: ['owner', 'editor', 'commenter'],
    resolveAccess: vi.fn(async (documentId: string) => {
      if (documentId === 'missing-doc') throw new HTTPException(404, { message: 'Document not found' });
      if (documentId === 'other-doc') throw new HTTPException(403, { message: 'You do not have access to this document.' });
      return { document: { id: documentId }, role: documentId === 'viewer-doc' ? 'viewer' : 'owner' };
    }),
  };
});

vi.mock('../src/lib/assist-store.js', () => {
  let counter = 0;
  const copy = (thread: any) => thread && { ...thread, messages: [...thread.messages] };
  return {
    isUuid: (value: unknown) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value),
    listChatThreads: async (userId: string, documentId: string | null) =>
      [...state.threads.values()]
        .filter((thread) => thread.user_id === userId && thread.document_id === documentId)
        .map((thread) => ({ id: thread.id, title: thread.title, updated_at: thread.updated_at, message_count: thread.messages.length })),
    getChatThread: async (id: string, userId: string) => {
      const thread = state.threads.get(id);
      return thread && thread.user_id === userId ? copy(thread) : null;
    },
    createChatThread: async (documentId: string | null, userId: string, title: string) => {
      counter += 1;
      const id = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
      const thread = { id, document_id: documentId, user_id: userId, title, messages: [], updated_at: new Date('2026-10-28T10:00:00Z') };
      state.threads.set(id, thread);
      return copy(thread);
    },
    appendChatMessages: async (id: string, messages: any[]) => {
      const thread = state.threads.get(id);
      thread.messages = [...thread.messages, ...messages].slice(-200);
      thread.updated_at = new Date();
    },
    deleteChatThread: async (id: string, userId: string) => {
      const thread = state.threads.get(id);
      if (!thread || thread.user_id !== userId) return false;
      state.threads.delete(id);
      return true;
    },
    searchLibrary: async () => state.library,
    libraryDocumentIdsInFolders: async () => [],
    getLibraryDocuments: async () => state.libraryDocs,
  };
});

import { createLlmSlot, LlmError } from '../src/slots/llm.js';
import { PapersError, createPapersSlot } from '../src/slots/papers.js';
import { USER, fakeLlm, fakePapers, makeApp, paper, parseSse, post } from './assist-helpers.js';

const NO_KEYS = { llmProvider: '', llmApiKey: '', llmBaseUrl: '', llmModel: '', llmReviewModel: '', videmakApiKey: '', videmakApiUrl: 'https://api.videmak.net', publicUrl: 'http://localhost:3000' };

beforeEach(() => {
  state.threads.clear();
  state.library = [];
  state.libraryDocs = [];
  state.usage = [];
});

const services = () => state.usage.map((event) => event.service);

describe('auth', () => {
  it('rejects signed-out requests with 401', async () => {
    const app = makeApp({ llm: fakeLlm('x'), papers: fakePapers() }, null);
    const response = await app.request('/api/ai-editor/assist/papers?q=sleep');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ detail: 'Sign in to continue.' });
  });
});

describe('GET /papers', () => {
  it('searches the papers slot and answers {results, total, page} with BibTeX', async () => {
    const urls: string[] = [];
    const works = [
      { id: 'https://openalex.org/W1', title: 'Exact title match', publication_year: 2021, cited_by_count: 0, authorships: [{ author: { display_name: 'Ann Lee' } }], doi: 'https://doi.org/10.1/a' },
      { id: 'https://openalex.org/W2', title: 'Highly cited classic', publication_year: 2005, cited_by_count: 5000, authorships: [{ author: { display_name: 'Bo Chen' } }], doi: 'https://doi.org/10.1/b', primary_location: { source: { display_name: 'Science' } } },
    ];
    const fetchMock = vi.fn(async (url: URL | string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ meta: { count: 1234 }, results: works }), { status: 200 });
    });
    const papers = createPapersSlot({ fetch: fetchMock as any, settings: { papersProvider: 'openalex', videmakApiKey: '', videmakApiUrl: '', scholarUrl: '', scholarApiKey: '', openalexEmail: 'dev@example.com' } });
    const app = makeApp({ llm: fakeLlm('x'), papers });

    const response = await app.request('/api/ai-editor/assist/papers?q=sleep%20memory&year_from=2000&min_cited=10&open_access=true&per_page=10');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(1234);
    expect(body.page).toBe(1);
    // Relevance blends in citations: the cited classic moves up.
    expect(body.results.map((item: any) => item.id)).toEqual(['W2', 'W1']);
    const first = body.results[0];
    expect(first).toMatchObject({ title: 'Highly cited classic', year: 2005, doi: '10.1/b', source_name: 'Science', cited_by_count: 5000, is_open_access: false, source_type: 'scholar' });
    expect(first.bibtex).toContain('@article{chen2005highly');
    expect(first.bibtex).toContain('journal = {Science}');
    const url = new URL(urls[0]);
    expect(url.searchParams.get('search')).toBe('sleep memory');
    expect(url.searchParams.get('per_page')).toBe('20');
    expect(url.searchParams.get('filter')).toBe('from_publication_date:2000-01-01,open_access.is_oa:true,cited_by_count:>9');
    expect(services()).toEqual(['papers_requests']);
  });

  it('passes the sort to the provider and checks the query', async () => {
    const papers = fakePapers([paper({ id: 'W1', cited_by_count: 1 }), paper({ id: 'W2', title: 'Other', cited_by_count: 99 })]);
    const app = makeApp({ llm: fakeLlm('x'), papers });
    const sorted = await (await app.request('/api/ai-editor/assist/papers?q=sleep&sort=cited')).json();
    expect(sorted.results.map((item: any) => item.id)).toEqual(['W2', 'W1']);
    expect((await app.request('/api/ai-editor/assist/papers?q=s')).status).toBe(422);
    expect((await app.request('/api/ai-editor/assist/papers?q=sleep&sort=best')).status).toBe(422);
  });

  it('answers 503 when the provider is down', async () => {
    const papers = { ...fakePapers(), search: async () => Promise.reject(new PapersError('busy', 'Paper search is busy. Try again.')) };
    const response = await makeApp({ llm: fakeLlm('x'), papers }).request('/api/ai-editor/assist/papers?q=sleep');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ detail: 'Paper search is busy. Try again.' });
  });
});

describe('GET /papers/lookup', () => {
  it('returns one paper for a DOI', async () => {
    const app = makeApp({ llm: fakeLlm('x'), papers: fakePapers() });
    const response = await app.request(`/api/ai-editor/assist/papers/lookup?doi=${encodeURIComponent('https://doi.org/10.1000/sleep.1')}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 'W1', title: 'Sleep and memory consolidation', is_open_access: true, cited_by_count: 50, abstract: 'Sleep helps memory.' });
    expect(services()).toEqual(['papers_requests']);
  });

  it('400 for a non-DOI, 404 when unknown', async () => {
    expect((await makeApp({ llm: fakeLlm('x'), papers: fakePapers() }).request('/api/ai-editor/assist/papers/lookup?doi=hello')).status).toBe(400);
    expect((await makeApp({ llm: fakeLlm('x'), papers: fakePapers() }).request('/api/ai-editor/assist/papers/lookup')).status).toBe(400);
    const missing = await makeApp({ llm: fakeLlm('x'), papers: fakePapers([], null) }).request('/api/ai-editor/assist/papers/lookup?doi=10.1000/none');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ detail: 'Paper not found' });
  });
});

describe('POST /papers/for-text', () => {
  it('lets the model write two searches and merges their papers', async () => {
    const papers = fakePapers([paper(), paper({ id: 'W2', doi: '10.1000/two', title: 'Second' })]);
    const llm = fakeLlm('```json\n["sleep memory consolidation", "slow wave sleep learning"]\n```');
    const response = await post(makeApp({ llm, papers }), '/api/ai-editor/assist/papers/for-text', { text: 'Sleep consolidates memories.', document_title: 'Sleep', limit: 10 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.queries).toEqual(['sleep memory consolidation', 'slow wave sleep learning']);
    expect(papers.queries).toEqual(body.queries);
    expect(body.results.map((item: any) => item.id)).toEqual(['W1', 'W2']);
    expect(body.results[0].bibtex).toMatch(/^@article\{smith2020sleep,/);
    expect(services()).toEqual(['llm_input_tokens', 'llm_output_tokens', 'papers_requests', 'papers_requests']);
  });

  it('falls back to a keyword query when no AI is configured', async () => {
    const papers = fakePapers();
    const body = await (await post(makeApp({ llm: createLlmSlot({ settings: NO_KEYS }), papers }), '/api/ai-editor/assist/papers/for-text', { text: 'Sleep consolidates memories during sleep.' })).json();
    expect(body.queries).toEqual(['sleep consolidates memories']);
  });
});

describe('POST /edit', () => {
  it('edits with numbered sources and returns the cited ones', async () => {
    const llm = fakeLlm('"Sleep strengthens memory [S1]."');
    const response = await post(makeApp({ llm, papers: fakePapers() }), '/api/ai-editor/assist/edit', {
      text: 'sleep good for memory',
      instruction: 'Make it academic',
      use_web: true,
      use_library: false,
      library_document_ids: [],
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.text).toBe('Sleep strengthens memory [S1].');
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0]).toMatchObject({ n: 1, marker: 'S1', title: 'Sleep and memory consolidation', authors: ['Jane Smith', 'Ali Khan'], year: 2020, source_type: 'scholar', url: 'https://example.org/sleep' });
    expect(body.sources[0].bibtex).toContain('@article');
    const prompt = llm.calls[0].messages[1].content;
    expect(prompt).toContain('[S1] Jane Smith, Ali Khan (2020). Sleep and memory consolidation. Nature Neuroscience');
    expect(prompt).toContain('INSTRUCTION: Make it academic');
    expect(llm.calls[0].messages[0].content).toContain('Keep every [[CITATION_n]] placeholder');
  });

  it('uses Library passages as sources', async () => {
    state.library = [
      {
        document: { id: '33333333-3333-4333-8333-333333333333', filename: 'a.pdf', title: 'My paper', authors: ['Kim Park'], doi: null, publisher: 'J Sleep', publication_date: '2019-05-01', abstract: 'Abstract', metadata: {} },
        passages: [{ content: 'Passage about sleep.', page: 3 }],
      },
    ];
    const llm = fakeLlm('Text [S1].');
    const body = await (await post(makeApp({ llm, papers: fakePapers() }), '/api/ai-editor/assist/edit', { text: 'sleep', instruction: 'cite', use_library: true })).json();
    expect(body.sources[0]).toMatchObject({ source_type: 'library', library_document_id: '33333333-3333-4333-8333-333333333333', year: '2019', authors: ['Kim Park'] });
    expect(body.sources[0].bibtex).toContain('@misc{library_3333333333334333,');
    expect(llm.calls[0].messages[1].content).toContain('Passage about sleep.');
  });

  it('503 when the AI is not configured, 402 when out of credit', async () => {
    const notConfigured = await post(makeApp({ llm: createLlmSlot({ settings: NO_KEYS }), papers: fakePapers() }), '/api/ai-editor/assist/edit', { text: 'a', instruction: 'b' });
    expect(notConfigured.status).toBe(503);
    expect(await notConfigured.json()).toEqual({ detail: 'AI is not configured: set VIDEMAK_API_KEY or LLM_API_KEY' });
    const quota = await post(makeApp({ llm: fakeLlm('', new LlmError('quota', 'Insufficient AI credits')), papers: fakePapers() }), '/api/ai-editor/assist/edit', { text: 'a', instruction: 'b' });
    expect(quota.status).toBe(402);
    expect(await quota.json()).toEqual({ detail: 'Insufficient AI credits' });
  });
});

describe('POST /complete', () => {
  it('returns the next sentence with a leading space, its sources and ms', async () => {
    const llm = fakeLlm('Sleep consolidates memory [S1].');
    const response = await post(makeApp({ llm, papers: fakePapers() }), '/api/ai-editor/assist/complete', { before: 'Memory improves after rest.', cite: true, document_title: 'Sleep' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.text).toBe(' Sleep consolidates memory [S1].');
    expect(body.sources.map((source: any) => source.marker)).toEqual(['S1']);
    expect(typeof body.ms).toBe('number');
    expect(llm.calls[0].maxTokens).toBe(90);
  });

  it('drops citation markers the model made up', async () => {
    const llm = fakeLlm(', and recall declines [[CITATION_1]] after short nights [S1, S9].');
    const response = await post(makeApp({ llm, papers: fakePapers() }), '/api/ai-editor/assist/complete', { before: 'Sleep restriction impairs memory', cite: true });
    const body = await response.json();
    expect(body.text).toBe(', and recall declines after short nights [S1].');
    expect(body.sources.map((source: any) => source.marker)).toEqual(['S1']);
    expect(llm.calls[0].messages[0].content).not.toContain('[[CITATION_n]]');
  });

  it('keeps the writer’s own citation placeholders', async () => {
    const llm = fakeLlm(' As shown before [[CITATION_2]], rest helps.');
    const response = await post(makeApp({ llm, papers: fakePapers() }), '/api/ai-editor/assist/complete', { before: 'Rest helps [[CITATION_2]].', cite: false });
    expect((await response.json()).text).toBe(' As shown before [[CITATION_2]], rest helps.');
    expect(llm.calls[0].messages[0].content).toContain('[[CITATION_n]]');
  });

  it('asks for something different when refining', async () => {
    const llm = fakeLlm('Another idea.');
    await post(makeApp({ llm, papers: fakePapers() }), '/api/ai-editor/assist/complete', { before: 'Text', cite: false, refine: 'Old idea.' });
    expect(llm.calls[0].messages[1].content).toContain('The writer rejected the last suggestion: "Old idea."');
  });
});

describe('POST /review', () => {
  it('returns comments anchored to exact quotes, in document order', async () => {
    const llm = fakeLlm(
      JSON.stringify([
        { block_id: 'b2', quote: 'This is   proven.', comment: 'Needs a citation.', severity: 'MAJOR', category: 'evidence', suggestion: 'x' },
        { block_id: 'b1', quote: '"very very good"', comment: 'Wordy.', severity: 'minor', category: 'style', suggestion: 'excellent' },
        { block_id: 'b1', quote: 'not in the text', comment: 'Dropped.', category: 'clarity' },
        { block_id: 'b1', quote: '[[CITATION_1]]', comment: 'Dropped.', category: 'citation' },
        { block_id: 'nope', quote: 'x', comment: 'Dropped.' },
      ]),
    );
    const response = await post(makeApp({ llm, papers: fakePapers() }), '/api/ai-editor/assist/review', {
      blocks: [
        { id: 'b1', text: 'The method is very very good [[CITATION_1]].' },
        { id: 'b2', text: 'This is proven.' },
        { id: 'b3', text: '   ' },
      ],
      scope: 'document',
    });
    expect(response.status).toBe(200);
    const { comments } = await response.json();
    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({ blockId: 'b1', quote: 'very very good', comment: 'Wordy.', severity: 'minor', category: 'style', suggestion: 'excellent' });
    expect(comments[0].id).toMatch(/^ai-[0-9a-f]{12}$/);
    expect(comments[1]).toMatchObject({ blockId: 'b2', quote: 'This is proven.', severity: 'major', category: 'evidence', suggestion: null });
    expect(llm.calls[0].task).toBe('review');
    expect(services()).toEqual(['review_words']);
    expect(state.usage[0].quantity).toBe(10);
  });

  it('502 when every chunk fails', async () => {
    const response = await post(makeApp({ llm: fakeLlm('', new Error('boom')), papers: fakePapers() }), '/api/ai-editor/assist/review', { blocks: [{ id: 'b1', text: 'Text here.' }] });
    expect(response.status).toBe(502);
  });
});

describe('POST /comment-reply', () => {
  it('answers in the thread', async () => {
    const llm = fakeLlm('  Try a shorter sentence.  ');
    const response = await post(makeApp({ llm, papers: fakePapers() }), '/api/ai-editor/assist/comment-reply', {
      quote: 'long sentence',
      block_text: 'A long sentence here.',
      thread: [{ author: 'Ana', text: 'Too long?' }],
      question: '@AI how to fix?',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: 'Try a shorter sentence.' });
    expect(llm.calls[0].messages[1].content).toContain('Ana: Too long?');
    expect(llm.calls[0].messages[0].content).toContain('You are Videmak AI replying inside a comment thread');
  });
});

describe('chat', () => {
  const chatBody = { document_id: 'doc-1', message: 'Which claims need citations?\nThanks', document_text: 'Sleep helps memory.', use_web: true };

  it('streams sources, deltas and done (SSE) and keeps the thread', async () => {
    const llm = fakeLlm('Cite the sleep claim [S1].');
    const app = makeApp({ llm, papers: fakePapers() });
    const response = await post(app, '/api/ai-editor/assist/chat', chatBody);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const events = parseSse(await response.text());
    expect(events.map((event) => event.event)).toEqual(['sources', 'delta', 'delta', 'delta', 'done']);
    const threadId = events[0].data.threadId;
    expect(events[0].data.sources[0].marker).toBe('S1');
    expect(events.filter((event) => event.event === 'delta').map((event) => event.data.text).join('')).toBe('Cite the sleep claim [S1].');
    const done = events[4].data;
    expect(done.threadId).toBe(threadId);
    expect(done.message).toMatchObject({ role: 'assistant', content: 'Cite the sleep claim [S1].' });
    expect(done.message.sources.map((source: any) => source.n)).toEqual([1]);
    expect(llm.calls[0].messages[1].content).toContain('CURRENT DOCUMENT (Untitled):\nSleep helps memory.');
    expect(services()).toEqual(['papers_requests', 'llm_input_tokens', 'llm_output_tokens']);

    // The thread is listed and readable; a follow-up sends the history.
    const list = await (await app.request('/api/ai-editor/assist/chats?document_id=doc-1')).json();
    expect(list.chats).toEqual([{ id: threadId, title: 'Which claims need citations?', updatedAt: expect.any(String), messageCount: 2 }]);
    const thread = await (await app.request(`/api/ai-editor/assist/chats/${threadId}`)).json();
    expect(thread.messages.map((message: any) => message.role)).toEqual(['user', 'assistant']);
    expect(thread).toMatchObject({ id: threadId, messageCount: 2 });

    await (await post(app, '/api/ai-editor/assist/chat', { ...chatBody, thread_id: threadId, message: 'More?' })).text();
    expect(llm.calls[1].messages.map((message) => message.role)).toEqual(['system', 'system', 'user', 'assistant', 'user']);
    expect((await (await app.request(`/api/ai-editor/assist/chats/${threadId}`)).json()).messageCount).toBe(4);
  });

  it('works without a document (standalone AI Chat)', async () => {
    const llm = fakeLlm('Answer.');
    const app = makeApp({ llm, papers: fakePapers() });
    await (await post(app, '/api/ai-editor/assist/chat', { ...chatBody, document_id: 'doc-1' })).text();
    const events = parseSse(await (await post(app, '/api/ai-editor/assist/chat', { message: 'Hello', document_text: 'ignored', document_id: null })).text());
    expect(events.at(-1)?.event).toBe('done');
    expect(llm.calls[1].messages[0].content).toContain('research writing assistant for academic work');
    expect(llm.calls[1].messages[1].content).not.toContain('CURRENT DOCUMENT');
    const standalone = await (await app.request('/api/ai-editor/assist/chats')).json();
    expect(standalone.chats.map((chat: any) => chat.title)).toEqual(['Hello']);
    const forDocument = await (await app.request('/api/ai-editor/assist/chats?document_id=doc-1')).json();
    expect(forDocument.chats).toHaveLength(1);
  });

  it('checks document access and thread ownership', async () => {
    const app = makeApp({ llm: fakeLlm('x'), papers: fakePapers() });
    expect((await post(app, '/api/ai-editor/assist/chat', { ...chatBody, document_id: 'missing-doc' })).status).toBe(404);
    expect((await post(app, '/api/ai-editor/assist/chat', { ...chatBody, document_id: 'other-doc' })).status).toBe(403);
    expect((await app.request('/api/ai-editor/assist/chats?document_id=other-doc')).status).toBe(403);
    expect((await post(app, '/api/ai-editor/assist/chat', { ...chatBody, thread_id: '00000000-0000-4000-8000-999999999999' })).status).toBe(404);
    expect((await app.request('/api/ai-editor/assist/chats/not-a-thread')).status).toBe(404);
  });

  it('503 before streaming when the AI is not configured', async () => {
    const response = await post(makeApp({ llm: createLlmSlot({ settings: NO_KEYS }), papers: fakePapers() }), '/api/ai-editor/assist/chat', chatBody);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ detail: 'AI is not configured: set VIDEMAK_API_KEY or LLM_API_KEY' });
    expect(state.threads.size).toBe(0);
  });

  it('sends an error event (402) when the provider is out of credit', async () => {
    const response = await post(makeApp({ llm: fakeLlm('', new LlmError('quota', 'Insufficient AI credits')), papers: fakePapers() }), '/api/ai-editor/assist/chat', chatBody);
    const events = parseSse(await response.text());
    expect(events.map((event) => event.event)).toEqual(['sources', 'error']);
    expect(events[1].data).toEqual({ status: 402, detail: 'Insufficient AI credits' });
  });

  it('deletes a thread', async () => {
    const app = makeApp({ llm: fakeLlm('x'), papers: fakePapers() });
    const events = parseSse(await (await post(app, '/api/ai-editor/assist/chat', chatBody)).text());
    const threadId = events[0].data.threadId;
    const removed = await app.request(`/api/ai-editor/assist/chats/${threadId}`, { method: 'DELETE' });
    expect(await removed.json()).toEqual({ success: true });
    expect((await app.request(`/api/ai-editor/assist/chats/${threadId}`, { method: 'DELETE' })).status).toBe(404);
    expect(state.usage[0].accountId).toBe(USER.account_id);
  });
});

describe('Review panel checks', () => {
  const blocks = [{ id: 'b1', text: 'Sleep always improves memory in every adult. Most students sleep badly.' }];

  it('claim check keeps its own categories and suggests only for overstated claims', async () => {
    const llm = fakeLlm(JSON.stringify([
      { block_id: 'b1', quote: 'Sleep always improves memory in every adult.', comment: 'Too strong.', severity: 'minor', category: 'Overstated', suggestion: 'Sleep often improves memory in adults.' },
      { block_id: 'b1', quote: 'Most students sleep badly.', comment: 'Needs a source.', severity: 'major', category: 'unsupported', suggestion: 'x' },
      { block_id: 'b1', quote: 'Most students', comment: 'Odd.', category: 'grammar' },
    ]));
    const response = await post(makeApp({ llm, papers: fakePapers() }), '/api/ai-editor/assist/review', { blocks, mode: 'claims' });
    const { comments } = await response.json();
    expect(comments.map((comment: any) => comment.category)).toEqual(['overstated', 'unsupported', 'unsupported']);
    expect(comments[0].suggestion).toBe('Sleep often improves memory in adults.');
    expect(comments[1].suggestion).toBeNull();
    expect(llm.calls[0].messages[0].content).toContain('weakly_supported');
  });

  it('proofread returns corrections with their replacement text', async () => {
    const llm = fakeLlm(JSON.stringify([{ block_id: 'b1', quote: 'sleep badly', comment: 'Word choice.', category: 'word choice', suggestion: 'sleep poorly' }]));
    const response = await post(makeApp({ llm, papers: fakePapers() }), '/api/ai-editor/assist/review', { blocks, mode: 'proofread' });
    expect((await response.json()).comments[0]).toMatchObject({ category: 'word_choice', suggestion: 'sleep poorly' });
  });

  it('tone uses the chosen tone in the prompt', async () => {
    const llm = fakeLlm('[]');
    await post(makeApp({ llm, papers: fakePapers() }), '/api/ai-editor/assist/review', { blocks, mode: 'tone', tone: 'confident and concise' });
    expect(llm.calls[0].messages[0].content).toContain('confident and concise');
  });

  it('peer review returns the report and its recommendation, metered as review words', async () => {
    const text = 'Sleep matters for memory. '.repeat(40);
    const llm = fakeLlm('## Summary\nGood.\n\nRecommendation: Minor revision');
    const response = await post(makeApp({ llm, papers: fakePapers() }), '/api/ai-editor/assist/peer-review', { text, document_title: 'Sleep' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ recommendation: 'Minor revision', reviewedWords: 160, truncated: false });
    expect(state.usage.some((event) => event.service === 'review_words')).toBe(true);
    const short = await post(makeApp({ llm, papers: fakePapers() }), '/api/ai-editor/assist/peer-review', { text: 'Too short.' });
    expect(short.status).toBe(422);
  });

  it('source quality flags retracted, preprint, missing and mismatched sources', async () => {
    const retracted = paper({ title: 'Sleep and memory consolidation', is_retracted: true } as any);
    const preprintPapers = fakePapers([paper({ title: 'A preprint about sleep', type: 'preprint' })], null);
    const app = makeApp({ llm: fakeLlm(''), papers: fakePapers([], retracted) });
    const first = await post(app, '/api/ai-editor/assist/source-quality', {
      sources: [
        { key: 'a', doi: '10.1/a', title: 'Sleep and memory consolidation', year: 2020 },
        { key: 'b', doi: '10.1/b', title: 'Completely different heart surgery outcomes', year: 1990 },
      ],
    });
    const { results } = await first.json();
    expect(results[0]).toMatchObject({ key: 'a', status: 'problem' });
    expect(results[0].flags.map((flag: any) => flag.kind)).toEqual(['retracted']);
    expect(results[1].flags.map((flag: any) => flag.kind)).toEqual(['retracted', 'mismatch', 'old']);
    const second = await post(makeApp({ llm: fakeLlm(''), papers: preprintPapers }), '/api/ai-editor/assist/source-quality', {
      sources: [{ key: 'c', title: 'A preprint about sleep' }, { key: 'd', title: 'Nothing like it' }],
    });
    const more = (await second.json()).results;
    expect(more[0]).toMatchObject({ status: 'warning', flags: [{ kind: 'preprint' }] });
    expect(more[1]).toMatchObject({ status: 'problem', flags: [{ kind: 'not_found' }] });
    expect(state.usage.filter((event) => event.service === 'reference_checks').map((event) => event.quantity)).toEqual([2, 2]);
  });
});

describe('cutRepeatedFollowingText', () => {
  it('stops where the model starts repeating the text after the cursor', async () => {
    const { cutRepeatedFollowingText } = await import('../src/routes/assist.js');
    const after = ' declines measurably, even when total study time is held constant.';
    expect(cutRepeatedFollowingText(' quickly and  sharply declines measurably, even when total study time', after)).toBe(' quickly and  sharply');
    expect(cutRepeatedFollowingText(' quickly and sharply.', after)).toBe(' quickly and sharply.');
    expect(cutRepeatedFollowingText(' declines measurably, even when total', after)).toBe('');
  });
});

describe('POST /complete with length conclude', () => {
  const reply = JSON.stringify({ text: ' Together, these gaps limit prevention [S1].', next_heading: '## Methods', title: 'Malaria in Pregnancy' });
  it('returns the conclusion, the next heading and a title for an untitled document', async () => {
    const response = await post(makeApp({ llm: fakeLlm(reply), papers: fakePapers() }), '/api/ai-editor/assist/complete', { before: 'Sleep supports memory consolidation, yet uptake of sleep advice remains uneven.', cite: true, length: 'conclude', document_title: 'Untitled document', outline: ['Introduction'] });
    expect(await response.json()).toMatchObject({ text: ' Together, these gaps limit prevention [S1].', heading: 'Methods', title: 'Malaria in Pregnancy' });
  });
  it('proposes no heading when the next section exists or the outline has it, and keeps a real title', async () => {
    const app = makeApp({ llm: fakeLlm(reply), papers: fakePapers() });
    const later = await post(app, '/api/ai-editor/assist/complete', { before: 'Uptake remains uneven.', cite: false, length: 'conclude', document_title: 'My thesis', next_section_exists: true });
    expect(await later.json()).toMatchObject({ heading: null, title: null });
    const known = await post(app, '/api/ai-editor/assist/complete', { before: 'Uptake remains uneven.', cite: false, length: 'conclude', outline: ['Introduction', '2. Methods'] });
    expect((await known.json()).heading).toBeNull();
  });
});
