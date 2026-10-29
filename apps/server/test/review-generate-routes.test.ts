import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'test-secret-for-review-routes-0123456789';
  return { usage: [] as any[], libraryDocs: [] as any[] };
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
      return { document: { id: documentId }, role: documentId === 'viewer-doc' ? 'viewer' : 'owner' };
    }),
  };
});

vi.mock('../src/lib/assist-store.js', () => ({
  isUuid: () => true,
  searchLibrary: async () => [],
  getLibraryDocuments: async () => state.libraryDocs,
  listChatThreads: async () => [],
  getChatThread: async () => null,
  createChatThread: async () => null,
  appendChatMessages: async () => undefined,
  deleteChatThread: async () => false,
}));

import { createLlmSlot } from '../src/slots/llm.js';
import { findUnusedSpan } from '../src/routes/review.js';
import { inTextCitation } from '../src/routes/generate.js';
import { fakeLlm, fakePapers, makeApp, post } from './assist-helpers.js';

beforeEach(() => {
  state.usage = [];
  state.libraryDocs = [];
});

describe('POST /api/ai-editor/review', () => {
  const text = 'The results was clear and the data are very very convincing [[CITATION_1]].';

  it('returns issues with exact offsets, skipping ones that touch citations', async () => {
    const llm = fakeLlm(
      JSON.stringify({
        issues: [
          { category: 'Grammar', severity: 'High', title: 'Agreement', explanation: 'Plural subject.', original_text: 'results was', suggested_text: 'results were' },
          { category: 'concision', original_text: 'very very convincing', suggested_text: 'convincing' },
          { category: 'rewrite', original_text: 'convincing [[CITATION_1]]', suggested_text: 'strong [[CITATION_1]]' },
          { category: 'grammar', original_text: 'not there', suggested_text: 'x' },
          { category: 'grammar', original_text: 'same', suggested_text: 'same' },
        ],
      }),
    );
    const response = await post(makeApp({ llm, papers: fakePapers() }), '/api/ai-editor/review', {
      request_id: 'r1',
      text,
      block_id: 'block-1',
      citation_placeholders: ['[[CITATION_1]]'],
      max_issues: 5,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, model: 'fake', provider: 'fake', raw_issue_count: 5, error: null });
    expect(body.issues).toHaveLength(2);
    expect(body.issues[0]).toMatchObject({
      category: 'grammar',
      severity: 'high',
      title: 'Agreement',
      explanation: 'Plural subject.',
      original_text: 'results was',
      suggested_text: 'results were',
      block_id: 'block-1',
      start_offset: 4,
      end_offset: 15,
    });
    expect(body.issues[1]).toMatchObject({ title: 'Writing suggestion', severity: 'low', original_text: 'very very convincing', start_offset: text.indexOf('very very') });
    expect(llm.calls[0]).toMatchObject({ task: 'review', json: true });
    expect(llm.calls[0].messages[1].content).toContain('CITATION PLACEHOLDERS: ["[[CITATION_1]]"]');
    expect(state.usage.map((event) => [event.service, event.quantity])).toEqual([['review_words', 12]]);
  });

  it('finds spans case-insensitively and never twice', () => {
    expect(findUnusedSpan('Data data DATA', 'data', [])).toEqual([5, 9]);
    expect(findUnusedSpan('Data data DATA', 'data', [[5, 9]])).toEqual([0, 4]);
  });

  it('503 without an AI key', async () => {
    const response = await post(makeApp({ llm: createLlmSlot({ settings: { llmProvider: '', llmApiKey: '', llmBaseUrl: '', llmModel: '', llmReviewModel: '', videmakApiKey: '', videmakApiUrl: 'x', publicUrl: 'x' } }), papers: fakePapers() }), '/api/ai-editor/review', { text });
    expect(response.status).toBe(503);
  });
});

describe('POST /api/editor/generate', () => {
  const context = { topic: 'Sleep and memory', document_title: 'Sleep', document_summary: '', current_section_title: '', current_section_content: 'Earlier text.', previous_paragraph: 'Previous.', citations: [] };

  it('writes a paragraph and turns {citation_node: ID} into citation chips', async () => {
    const llm = fakeLlm((messages) => {
      const prompt = messages[messages.length - 1].content;
      if (prompt.startsWith('Extract 3-5')) return '["sleep memory", "consolidation"]';
      const id = /Paper 1 \(ID: (\w+)\)/.exec(prompt)?.[1];
      return `Sleep consolidates memory {citation_node: ${id}}. Unknown claim {citation_node: PAPER_NOPE}.`;
    });
    const response = await post(makeApp({ llm, papers: fakePapers() }), '/api/editor/generate', { type: 'paragraph', context, source_type: 'web', document_id: 'doc-1', request_id: 'r1' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, type: 'paragraph', text: expect.stringContaining('{citation_node: PAPER_') });
    expect(body.id).toMatch(/^content_PAPER_/);
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0]).toMatchObject({ id: expect.stringMatching(/^PAPER_/), displayText: '(Smith et al., 2020)' });
    expect(Buffer.from(body.citations[0].base64, 'base64').toString()).toBe(body.citations[0].bibtex);
    expect(body.html).toMatch(/^<p>Sleep consolidates memory <span class="citation-token" contenteditable="false" data-citation="[^"]+" data-citation-id="PAPER_\w+" data-cy="editor-preview-citation-node">\(Smith et al\., 2020\)<\/span>\. Unknown claim \.<\/p>$/);
    expect(llm.calls[1].messages[0].content).toContain('Use {citation_node: PAPER_ID} format for citations.');
  });

  it('writes a title as <h1>', async () => {
    const llm = fakeLlm((messages) => (messages[messages.length - 1].content.startsWith('Extract') ? '["a"]' : 'A Study of Sleep & Memory'));
    const body = await (await post(makeApp({ llm, papers: fakePapers() }), '/api/editor/generate', { type: 'title', context: { topic: 'sleep' } })).json();
    expect(body).toMatchObject({ success: true, type: 'title', text: 'A Study of Sleep & Memory', html: '<h1>A Study of Sleep &amp; Memory</h1>', citations: [] });
  });

  it('cites the writer\'s Library papers', async () => {
    state.libraryDocs = [{ id: '44444444-4444-4444-8444-444444444444', filename: 'x.pdf', title: 'Sleep paper', authors: ['Lee Wong'], doi: '10.5/x', publisher: null, publication_date: '2015', abstract: 'Sleep.', metadata: {} }];
    const llm = fakeLlm((messages) => (messages[messages.length - 1].content.startsWith('Extract') ? '["sleep"]' : 'Claim {citation_node: LIBRARY_44444444444444448444444444444444}.'));
    const body = await (await post(makeApp({ llm, papers: fakePapers() }), '/api/editor/generate', { type: 'paragraph', context, source_type: 'myfiles', selected_document_ids: ['44444444-4444-4444-8444-444444444444'] })).json();
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0]).toMatchObject({ id: 'LIBRARY_44444444444444448444444444444444', displayText: '(Wong, 2015)' });
    expect(body.citations[0].bibtex).toContain('doi = {10.5/x}');
  });

  it('rejects bad types and viewers; recovery routes answer 404', async () => {
    const app = makeApp({ llm: fakeLlm('x'), papers: fakePapers() });
    expect((await post(app, '/api/editor/generate', { type: 'poem', context })).status).toBe(400);
    expect((await post(app, '/api/editor/generate', { type: 'paragraph', context, document_id: 'viewer-doc' })).status).toBe(403);
    expect((await app.request('/api/editor/documents/doc-1/generation?request_id=r1')).status).toBe(404);
    expect((await post(app, '/api/editor/generations/abc/delivery', { action: 'seen' })).status).toBe(404);
  });

  it('formats in-text citations from either name order', () => {
    expect(inTextCitation(['Smith, John'], '2020')).toBe('(Smith, 2020)');
    expect(inTextCitation(['John Smith', 'Ann Lee'], '2020')).toBe('(Smith et al., 2020)');
    expect(inTextCitation([], 'n.d.')).toBe('(Unknown, n.d.)');
  });
});
