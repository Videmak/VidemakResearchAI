/**
 * The AI writing flow (title -> subtitle -> paragraphs with citations -> conclusion).
 * POST /generate answers synchronously with the
 * suggestion, which the browser (useAISuggestion.ts) accepts directly; there are no queued
 * jobs, so the recovery routes always answer 404 and the browser starts fresh.
 */
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { requireUser, type AppVariables, type AuthUser } from '../auth.js';
import { EDIT_ROLES, resolveAccess } from '../lib/access.js';
import type { Slots } from '../slots/types.js';
import { LlmError, llmUnavailable } from '../slots/llm.js';
import { generationPaperContext, generationPrompts, keywordsPrompt, languageInstruction, type GenerationPaper } from '../lib/prompts.js';
import { completeMetered, currentUser, escapeRegExp, isBlockingLlmError, parseBody, parseJsonPayload, toHttpError } from '../lib/assist-llm.js';
import { libraryBibtex, libraryAuthors, libraryYear, searchEditorPapers } from '../lib/assist-papers.js';
import { getLibraryDocuments } from '../lib/assist-store.js';
import { planQuota } from '../lib/plans.js';

const text = z.string().nullish();

const GenerateRequest = z.object({
  type: z.string().min(1).max(40),
  context: z.object({
    topic: z.string().max(20000),
    document_title: text,
    document_summary: text,
    current_section_title: text,
    current_section_content: text,
    previous_paragraph: text,
    language: z.string().max(10).nullish(),
    citations: z.array(z.object({ id: z.string().max(200), bibtex: z.string().max(20000) })).default([]),
  }),
  source_type: z.enum(['web', 'myfiles', 'hybrid']).default('web'),
  selected_document_ids: z.array(z.string().max(64)).max(200).default([]),
  folder_id: z.string().nullish(),
  request_id: z.string().max(100).nullish(),
  document_id: z.string().max(64).nullish(),
  target_block_id: z.string().max(255).nullish(),
  target_cursor_position: z.number().int().min(0).nullish(),
  document_revision: z.number().int().min(0).nullish(),
  flow_mode: z.enum(['start', 'inline']).default('inline'),
});

type Request = z.output<typeof GenerateRequest>;
type CitablePaper = GenerationPaper & { bibtex: string; authors: string[] };
type Citation = { id: string; bibtex: string; base64: string; displayText: string };

const CONTENT_TYPES = ['title', 'subtitle', 'paragraph', 'conclusive'];

function citationNodeId(taken: Set<string>): string {
  for (;;) {
    const id = `PAPER_${Date.now().toString(16)}${(1000 + Math.floor(Math.random() * 9000)).toString(16)}`.toUpperCase();
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

/** "(Smith, 2020)" / "(Smith et al., 2020)"; "Smith, John" and "John Smith" both give Smith. */
export function inTextCitation(authors: string[], year: string): string {
  if (!authors.length) return `(Unknown, ${year})`;
  const first = (authors[0] || '').trim();
  const surname = first.includes(',') ? first.split(',')[0].trim() : first.split(/\s+/).pop() || 'Unknown';
  return authors.length === 1 ? `(${surname || 'Unknown'}, ${year})` : `(${surname || 'Unknown'} et al., ${year})`;
}

/** The citation chip the editor imports: BibTeX travels base64-encoded in data-citation. */
export function citationHtml(citationId: string, bibtex: string): string {
  const year = /year\s*=\s*[{"]?(\d{4})[}"]?/i.exec(bibtex)?.[1] || 'n.d.';
  const author = /author\s*=\s*[{"]([^}"]+)[}"]/i.exec(bibtex)?.[1];
  const authors = author ? author.split(/\s+and\s+/).map((name) => name.trim()) : ['Unknown'];
  const base64 = Buffer.from(bibtex, 'utf8').toString('base64');
  return `<span class="citation-token" contenteditable="false" data-citation="${base64}" data-citation-id="${citationId}" data-cy="editor-preview-citation-node">${inTextCitation(authors, year)}</span>`;
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** {citation_node: ID} markers -> citation chips for papers we know; unknown ones are removed. */
export function renderCitations(textValue: string, papers: Map<string, CitablePaper>): { html: string; citations: Citation[] } {
  let html = escapeHtml(textValue);
  // The model writes the marker in several ways; normalise first.
  html = html.replace(/\{citation\s*node:/gi, '{citation_node:').replace(/\{citation[_*]?node:/gi, '{citation_node:');
  html = html.replace(/\{([^}]*citation[_\s]*node[^}]*;[^}]*)\}/gi, (_match, inner: string) =>
    inner
      .split(';')
      .map((part) => /(?:citation[_\s]*node:?\s*)?(\w+)/i.exec(part.trim())?.[1])
      .filter(Boolean)
      .map((id) => `{citation_node: ${id}}`)
      .join(' '),
  );
  const citations: Citation[] = [];
  const ids = [...new Set([...html.matchAll(/\{citation_node:\s*(\w+)\}/gi)].map((match) => match[1]))];
  for (const id of ids) {
    const marker = new RegExp(`\\{citation_node:\\s*${escapeRegExp(id)}\\}`, 'gi');
    const paper = papers.get(id);
    if (!paper?.bibtex) {
      html = html.replace(marker, '');
      continue;
    }
    html = html.replace(marker, citationHtml(id, paper.bibtex));
    citations.push({
      id,
      bibtex: paper.bibtex,
      base64: Buffer.from(paper.bibtex, 'utf8').toString('base64'),
      displayText: inTextCitation(paper.authors, String(paper.year || 'n.d.')),
    });
  }
  html = html.replace(/\{citation[_\s]*node:\s*\w+\}/gi, '').replace(/\{citation[_\s]*node[^}]*\}/gi, '');
  return { html, citations };
}

async function generateKeywords(slots: Slots, user: AuthUser, topic: string, title: string, type: string): Promise<string[]> {
  try {
    const raw = await completeMetered(
      slots.llm,
      user,
      { messages: [{ role: 'user', content: keywordsPrompt(topic, title, type) }], temperature: 0.3, maxTokens: 200 },
      { feature: `${type}-keywords` },
    );
    const parsed = parseJsonPayload(raw);
    const keywords = Array.isArray(parsed) ? parsed.map((keyword) => String(keyword).trim()).filter(Boolean) : [];
    if (keywords.length) return keywords;
  } catch (error) {
    console.warn('editor keywords failed:', (error as Error).message);
  }
  return topic.split(/\s+/).filter((word) => word.length > 4).slice(0, 5);
}

async function webPapers(slots: Slots, user: AuthUser, keywords: string[], taken: Set<string>): Promise<CitablePaper[]> {
  try {
    const { results } = await searchEditorPapers(slots, user, { query: keywords.join(' '), perPage: 5 });
    return results.map((paper) => ({
      citation_id: citationNodeId(taken),
      title: paper.title,
      authors: paper.authors.map((author) => author.name).filter(Boolean),
      year: paper.year ? String(paper.year) : null,
      abstract: paper.abstract,
      bibtex: paper.bibtex,
    }));
  } catch (error) {
    console.warn('editor web papers failed:', (error as Error).message);
    return [];
  }
}

/** The writer's chosen Library papers, most on-topic first; only those that can be cited properly. */
async function libraryPapers(user: AuthUser, ids: string[], keywords: string[]): Promise<CitablePaper[]> {
  const documents = await getLibraryDocuments(user.id, ids);
  const terms = new Set(keywords.flatMap((keyword) => keyword.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || []));
  const score = (value: string) => [...terms].reduce((sum, term) => sum + (value.split(term).length - 1), 0);
  return documents
    .map((doc) => ({ doc, score: score(`${doc.title || ''} ${doc.abstract || ''}`.toLowerCase()) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ doc }): CitablePaper | null => {
      const bibtex = libraryBibtex(doc);
      if (!bibtex) return null;
      return {
        citation_id: `LIBRARY_${doc.id.replace(/-/g, '').toUpperCase()}`,
        title: doc.title || doc.filename || 'Untitled',
        authors: libraryAuthors(doc),
        year: libraryYear(doc),
        abstract: doc.abstract,
        bibtex,
      };
    })
    .filter((paper): paper is CitablePaper => paper !== null);
}

async function generate(slots: Slots, user: AuthUser, request: Request) {
  const type = request.type.toLowerCase();
  const context = request.context;
  const keywords = await generateKeywords(slots, user, context.topic, context.document_title || '', type);

  const taken = new Set<string>();
  const papers: CitablePaper[] = [];
  if (request.source_type === 'web' || request.source_type === 'hybrid') papers.push(...(await webPapers(slots, user, keywords, taken)));
  if ((request.source_type === 'myfiles' || request.source_type === 'hybrid') && request.selected_document_ids.length) {
    papers.push(...(await libraryPapers(user, request.selected_document_ids, keywords)));
  }
  // Citations already in the document may be cited again.
  for (const citation of context.citations) {
    papers.push({ citation_id: citation.id, title: 'Existing citation', authors: [], year: null, abstract: null, bibtex: citation.bibtex });
  }

  const prompts = generationPrompts(type, context, generationPaperContext(papers));
  const response = await completeMetered(
    slots.llm,
    user,
    {
      messages: [
        { role: 'system', content: prompts.system + languageInstruction(context.language) },
        { role: 'user', content: prompts.user },
      ],
      temperature: 0.7,
      maxTokens: type === 'paragraph' || type === 'conclusive' ? 800 : 200,
    },
    { feature: type },
  );

  const plain = (response || '').trim();
  let html = escapeHtml(plain);
  let citations: Citation[] = [];
  if (type === 'paragraph' || type === 'conclusive') {
    ({ html, citations } = renderCitations(plain, new Map(papers.map((paper) => [paper.citation_id, paper]))));
  }
  if (type === 'title') html = `<h1>${html}</h1>`;
  else if (type === 'subtitle') html = `<h2>${html}</h2>`;
  else if (!html.trim().startsWith('<p>')) html = `<p>${html}</p>`;

  return { success: true, id: `content_${citationNodeId(taken)}`, type, text: plain, html, citations };
}

/** Mount at /api/editor (routes: POST /generate, GET /documents/:id/generation, POST /generations/:id/delivery). */
export function generateRoutes(slots: Slots) {
  const app = new Hono<{ Variables: AppVariables }>();

  // requireUser per route, so mounting here never guards other /api/editor routes.
  // Write with AI counts a draft once, at its first step (the title), and only when it worked.
  const draftQuota = planQuota('write', {
    applies: async (c) => String(((await c.req.json().catch(() => ({}))) as { type?: string }).type || '').toLowerCase() === 'title',
    counted: (body) => body?.success !== false,
  });
  app.post('/generate', requireUser, draftQuota, async (c) => {
    const user = currentUser(c);
    const request = await parseBody(c, GenerateRequest);
    const type = request.type.toLowerCase();
    if (!CONTENT_TYPES.includes(type)) throw new HTTPException(400, { message: `Invalid content type: ${type}` });
    if (request.document_id) {
      const { role } = await resolveAccess(request.document_id, user);
      if (!EDIT_ROLES.includes(role)) throw new HTTPException(403, { message: 'Editor access is required' });
    }
    const unavailable = llmUnavailable(slots.llm);
    if (unavailable) throw new HTTPException(503, { message: unavailable });
    try {
      return c.json(await generate(slots, user, request));
    } catch (error) {
      if (isBlockingLlmError(error) || error instanceof HTTPException) throw toHttpError(error);
      console.error('editor generation failed:', error);
      const message = error instanceof LlmError ? error.message : 'The AI could not write this suggestion. Try again.';
      return c.json({ success: false, error: message });
    }
  });

  // Generations are never queued, so there is nothing to recover or acknowledge.
  app.get('/documents/:documentId/generation', requireUser, (c) => c.json({ detail: 'AI Editor generation not found' }, 404));
  app.post('/generations/:jobId/delivery', requireUser, (c) => c.json({ detail: 'AI Editor generation not found' }, 404));

  return app;
}
