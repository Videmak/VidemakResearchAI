/**
 * The editor assistant API (/api/ai-editor/assist): paper search for citing, AI Edit,
 * autocomplete, review comments, AI replies in comment threads and chat. Paths, bodies and
 * answers are what the editor's browser code (packages/editor/src/lib/aiEditor/assistApi.ts)
 * sends and expects.
 */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { requireUser, type AppVariables } from '../auth.js';
import { resolveAccess } from '../lib/access.js';
import type { ChatMessage, LlmUsage, Slots } from '../slots/types.js';
import { LlmError, estimateTokens, llmModelName, llmUnavailable } from '../slots/llm.js';
import { PapersError, isPagedPapersSlot } from '../slots/papers.js';
import {
  CLAIM_CATEGORIES,
  PROOFREAD_CATEGORIES,
  REVIEW_CATEGORIES,
  chatContextPrompt,
  chatSystemPrompt,
  commentReplySystemPrompt,
  commentReplyUserPrompt,
  completeSystemPrompt,
  completeUserPrompt,
  concludeSystemPrompt,
  editSystemPrompt,
  editUserPrompt,
  papersForTextPrompt,
  claimCheckSystemPrompt,
  peerReviewSystemPrompt,
  peerReviewUserPrompt,
  proofreadSystemPrompt,
  reviewCommentsSystemPrompt,
  reviewCommentsUserPrompt,
  sourcesPrompt,
  toneSystemPrompt,
} from '../lib/prompts.js';
import {
  completeMetered,
  countWords,
  currentUser,
  escapeRegExp,
  extractJsonObject,
  isBlockingLlmError,
  meterPapers,
  meterReferenceChecks,
  meterTokens,
  parseBody,
  parseJsonPayload,
  parseQuery,
  toHttpError,
  withHttpErrors,
} from '../lib/assist-llm.js';
import { contextQuery, dropInventedMarkers, gatherSources, queryFromText, searchEditorPapers, sharesTopic, toBrowserPaper, usedSources, withTimeout, type AssistSource, type BrowserPaper } from '../lib/assist-papers.js';
import {
  appendChatMessages,
  createChatThread,
  deleteChatThread,
  libraryDocumentIdsInFolders,
  getChatThread,
  listChatThreads,
  type StoredChatMessage,
} from '../lib/assist-store.js';
import { planQuota } from '../lib/plans.js';

// ------------------------------------------------------------------ request shapes

const optionalText = (max: number) => z.string().max(max).nullish();
const flag = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])])
  .transform((value) => value === true || value === 'true' || value === '1' || value === 'yes' || value === 'on');
const intParam = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const libraryIds = z.array(z.string().max(64)).max(50).default([]);

const PapersQuery = z.object({
  q: z.string().trim().min(2).max(300),
  page: intParam(1, 20).default(1),
  per_page: intParam(1, 25).default(10),
  year_from: intParam(1500, 2100).optional(),
  year_to: intParam(1500, 2100).optional(),
  min_cited: intParam(0, 100000).optional(),
  open_access: flag.optional(),
  sort: z.enum(['relevance', 'cited', 'newest']).default('relevance'),
});

const LookupQuery = z.object({
  doi: z.string().max(300).optional(),
  work_id: z.string().regex(/^W\d+$/).optional(),
});

const PapersForText = z.object({
  text: z.string().min(3).max(8000),
  document_title: optionalText(500),
  limit: z.number().int().min(1).max(20).default(8),
});

const EditRequest = z.object({
  text: z.string().min(1).max(12000),
  instruction: z.string().min(1).max(2000),
  document_title: optionalText(500),
  before: optionalText(4000),
  after: optionalText(4000),
  use_web: z.boolean().default(false),
  use_library: z.boolean().default(false),
  library_document_ids: libraryIds,
  language: optionalText(10),
});

const CompleteRequest = z.object({
  before: z.string().min(1).max(6000),
  after: optionalText(1000),
  document_title: optionalText(500),
  section_title: optionalText(500),
  cite: z.boolean().default(true),
  language: optionalText(10),
  refine: optionalText(600),
  /** sentence: autocomplete; paragraph: "AI suggest"; conclude: close the section (and name the next). */
  length: z.enum(['sentence', 'paragraph', 'conclude']).default('sentence'),
  /** Autocomplete settings: where sources come from and which papers count. */
  use_web: z.boolean().default(true),
  use_library: z.boolean().default(false),
  library_document_ids: libraryIds,
  library_folder_ids: z.array(z.string().max(64)).max(50).default([]),
  include_preprints: z.boolean().default(true),
  year_from: z.number().int().min(1900).max(2100).nullish(),
  min_cited: z.number().int().min(0).max(100000).nullish(),
  /** The document's headings, for Conclude to name the next section. */
  outline: z.array(z.string().max(300)).max(200).default([]),
  /** Conclude only: a later section already exists, so no new heading. */
  next_section_exists: z.boolean().default(false),
});

const ReviewRequest = z.object({
  blocks: z
    .array(z.object({ id: z.string().max(100), text: z.string().max(12000), heading: z.boolean().default(false) }))
    .min(1)
    .max(2000),
  document_title: optionalText(500),
  scope: z.enum(['document', 'block']).default('document'),
  focus: optionalText(1000),
  language: optionalText(10),
  /** general: margin comments; claims, proofread, tone: the Review panel's checks. */
  mode: z.enum(['general', 'claims', 'proofread', 'tone']).default('general'),
  tone: optionalText(200),
});

const PeerReviewRequest = z.object({
  text: z.string().min(1).max(200_000),
  document_title: optionalText(500),
  field: optionalText(200),
  language: optionalText(10),
});

const SourceQualityRequest = z.object({
  sources: z
    .array(z.object({ key: z.string().max(200), doi: optionalText(300), title: optionalText(600), year: z.union([z.number(), z.string().max(10)]).nullish() }))
    .min(1)
    .max(150),
});

const CommentReplyRequest = z.object({
  quote: z.string().max(4000).default(''),
  block_text: z.string().max(12000).default(''),
  document_title: optionalText(500),
  thread: z.array(z.record(z.any())).max(40).default([]),
  question: z.string().min(1).max(4000),
  language: optionalText(10),
});

const ChatRequest = z.object({
  // Omitted or null on the standalone AI Chat page (Library and papers only, no document).
  document_id: z.string().max(64).nullish().transform((value) => value || null),
  thread_id: optionalText(64),
  message: z.string().min(1).max(8000),
  document_title: optionalText(500),
  document_text: optionalText(400000),
  selection: optionalText(12000),
  use_document: z.boolean().default(true),
  use_web: z.boolean().default(false),
  use_library: z.boolean().default(false),
  library_document_ids: libraryIds,
  language: optionalText(10),
});

// ------------------------------------------------------------------ helpers

type ReviewBlock = z.output<typeof ReviewRequest>['blocks'][number];

const REVIEW_CATEGORY_SET = new Set<string>(REVIEW_CATEGORIES);
const SUGGESTION_CATEGORIES = new Set(['clarity', 'style', 'grammar']);

/** What each review mode asks for and which categories (and suggestions) it may return. */
const REVIEW_MODES = {
  general: { categories: REVIEW_CATEGORY_SET, fallback: 'clarity', suggestions: SUGGESTION_CATEGORIES, feature: 'review-comments' },
  claims: { categories: new Set<string>(CLAIM_CATEGORIES), fallback: 'unsupported', suggestions: new Set(['overstated', 'unverifiable']), feature: 'claim-check' },
  proofread: { categories: new Set<string>(PROOFREAD_CATEGORIES), fallback: 'grammar', suggestions: new Set<string>(PROOFREAD_CATEGORIES), feature: 'proofread' },
  tone: { categories: new Set(['tone']), fallback: 'tone', suggestions: new Set(['tone']), feature: 'tone' },
} as const;

/** The continuation up to where it starts repeating `after` (the writer's text after the cursor). */
export function cutRepeatedFollowingText(text: string, after?: string | null): string {
  const norm = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');
  const head = norm((after || '').trim()).slice(0, 30);
  if (head.length < 12) return text;
  const at = norm(text).indexOf(head);
  if (at <= 0) return at === 0 ? '' : text;
  // Map the position back onto the original text (whitespace runs collapse to one space).
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (seen >= at) return text.slice(0, index).trimEnd();
    if (!(/\s/.test(text[index]) && /\s/.test(text[index - 1] ?? ''))) seen += 1;
  }
  return text;
}

/** "Sleep and memory" vs "Sleep & Memory." — word overlap of two titles (0 to 1). */
export function titleSimilarity(a: string, b: string): number {
  const words = (value: string) => new Set(value.toLowerCase().replace(/&/g, ' and ').match(/[\p{L}\p{N}]+/gu) || []);
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

/** Splits the blocks into chunks of about `wordsPerChunk` words. */
export function reviewChunks(blocks: ReviewBlock[], wordsPerChunk = 5000): ReviewBlock[][] {
  const chunks: ReviewBlock[][] = [];
  let current: ReviewBlock[] = [];
  let count = 0;
  for (const block of blocks) {
    const words = countWords(block.text);
    if (current.length && count + words > wordsPerChunk) {
      chunks.push(current);
      current = [];
      count = 0;
    }
    current.push(block);
    count += words;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** The quote as it appears in the block (models often normalise whitespace or quotes). */
export function locateQuote(quote: string, text: string): string | null {
  const clean = (quote || '').trim().replace(/^"+|"+$/g, '');
  if (!clean) return null;
  if (text.includes(clean)) return clean;
  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const match = new RegExp(words.map(escapeRegExp).join('\\s+')).exec(text);
  return match ? match[0] : null;
}

const newId = () => randomUUID().replace(/-/g, '');

const threadSummary = (thread: { id: string; title: string; updated_at: Date | string }, messageCount: number) => ({
  id: thread.id,
  title: thread.title,
  updatedAt: new Date(thread.updated_at).toISOString(),
  messageCount,
});

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

// ------------------------------------------------------------------ routes

export function assistRoutes(slots: Slots) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', requireUser);

  // Plan allowances (Admin › Plans): refused when used up, counted after a useful answer.
  app.use('/edit', planQuota('ai_edit'));
  app.use('/complete', planQuota('autocomplete', { counted: (body) => Boolean(body?.text?.trim() || body?.heading) }));
  app.use('/review', planQuota('review'));
  app.use('/peer-review', planQuota('review'));
  app.use('/source-quality', planQuota('review'));
  app.use('/chat', planQuota('chat'));

  // ---------------------------------------------------------------- paper search

  app.get('/papers', async (c) => {
    const user = currentUser(c);
    const query = parseQuery(c, PapersQuery);
    return withHttpErrors(async () =>
      c.json(
        await searchEditorPapers(slots, user, {
          query: query.q,
          page: query.page,
          perPage: query.per_page,
          yearFrom: query.year_from,
          yearTo: query.year_to,
          minCited: query.min_cited,
          openAccess: query.open_access,
          sort: query.sort,
        }),
      ),
    );
  });

  /** Cited-by, open access and abstract for a citation card. */
  app.get('/papers/lookup', async (c) => {
    const user = currentUser(c);
    const { doi, work_id: workId } = parseQuery(c, LookupQuery);
    if (!doi && !workId) throw new HTTPException(400, { message: 'Give a DOI or a work id' });
    const cleanDoi = (doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();
    if (cleanDoi && !/^10\.\d{4,9}\/\S+$/.test(cleanDoi)) throw new HTTPException(400, { message: 'Not a DOI' });
    let paper;
    try {
      if (cleanDoi) paper = await slots.papers.lookupDoi(cleanDoi);
      else if (isPagedPapersSlot(slots.papers)) paper = await slots.papers.lookupWork(workId!);
      else throw new HTTPException(400, { message: 'Give a DOI' });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      if (error instanceof PapersError && error.code === 'not_configured') throw toHttpError(error);
      throw new HTTPException(503, { message: 'Paper details are busy; try again' });
    }
    await meterPapers(user, { feature: 'paper-lookup', provider: slots.papers.provider });
    if (!paper) throw new HTTPException(404, { message: 'Paper not found' });
    return c.json(toBrowserPaper(paper));
  });

  /** Find citations for a passage: the model writes two searches, the papers slot answers both. */
  app.post('/papers/for-text', async (c) => {
    const user = currentUser(c);
    const body = await parseBody(c, PapersForText);
    let queries: string[] = [];
    try {
      const raw = await completeMetered(
        slots.llm,
        user,
        { messages: [{ role: 'user', content: papersForTextPrompt(body.text, body.document_title) }], temperature: 0.2, maxTokens: 120 },
        { feature: 'find-citations' },
      );
      const payload = parseJsonPayload(raw);
      queries = (Array.isArray(payload) ? payload : []).map((query) => String(query).trim()).filter(Boolean).slice(0, 2);
    } catch (error) {
      // Out of credit stops here; without a configured model the keyword query still finds papers.
      if (error instanceof LlmError && error.code === 'quota') throw toHttpError(error);
      console.warn('find-citations query writing failed:', (error as Error).message);
    }
    if (!queries.length) queries = [queryFromText(body.text)];
    const perQuery = Math.max(4, body.limit);
    const batches = await Promise.allSettled(queries.map((query) => searchEditorPapers(slots, user, { query, perPage: perQuery })));
    const seen = new Set<string>();
    const papers: BrowserPaper[] = [];
    for (const batch of batches) {
      if (batch.status !== 'fulfilled') continue;
      for (const paper of batch.value.results) {
        const key = paper.doi || paper.id;
        if (key && !seen.has(key)) {
          seen.add(key);
          papers.push(paper);
        }
      }
    }
    return c.json({ queries, results: papers.slice(0, body.limit) });
  });

  // ---------------------------------------------------------------- AI Edit

  app.post('/edit', async (c) => {
    const user = currentUser(c);
    const body = await parseBody(c, EditRequest);
    return withHttpErrors(async () => {
      const sources = await gatherSources(slots, user, {
        query: queryFromText(`${body.instruction} ${body.text}`),
        useWeb: body.use_web,
        useLibrary: body.use_library,
        libraryDocumentIds: body.library_document_ids,
      });
      const raw = await completeMetered(
        slots.llm,
        user,
        {
          messages: [
            { role: 'system', content: editSystemPrompt(body.language) },
            {
              role: 'user',
              content: editUserPrompt({
                documentTitle: body.document_title,
                before: body.before,
                after: body.after,
                sources: sourcesPrompt(sources),
                instruction: body.instruction,
                text: body.text,
              }),
            },
          ],
          temperature: 0.4,
          maxTokens: Math.min(4000, Math.max(400, Math.floor(body.text.length / 2) + 600)),
        },
        { feature: 'ai-edit' },
      );
      const text = (raw || '').trim().replace(/^"+|"+$/g, '').trim();
      return c.json({ text, sources: usedSources(text, sources) });
    });
  });

  // ---------------------------------------------------------------- autocomplete

  app.post('/complete', async (c) => {
    const user = currentUser(c);
    const body = await parseBody(c, CompleteRequest);
    const started = Date.now();
    const writerText = `${body.before}\n${body.after || ''}`;
    return withHttpErrors(async () => {
      let sources: AssistSource[] = [];
      if (body.cite) {
        const query = contextQuery({ title: body.document_title, section: body.section_title, before: body.before });
        // "Limit Library to": chosen sources plus everything in chosen folders.
        const libraryDocumentIds = body.library_folder_ids.length
          ? [...new Set([...body.library_document_ids, ...(await libraryDocumentIdsInFolders(user.id, body.library_folder_ids))])]
          : body.library_document_ids;
        const scopedButEmpty = (body.library_document_ids.length || body.library_folder_ids.length) && !libraryDocumentIds.length;
        sources = await withTimeout(
          gatherSources(slots, user, {
            query,
            useWeb: body.use_web,
            useLibrary: body.use_library && !scopedButEmpty,
            libraryDocumentIds,
            limit: body.length === 'sentence' ? 4 : 6,
            filters: { yearFrom: body.year_from ?? null, minCited: body.min_cited ?? null, preprints: body.include_preprints },
          }),
          3500,
          [],
        );
        // Better no citation than one to an unrelated paper (the writer's own Library always counts).
        sources = sources
          .filter((source) => source.source_type === 'library' || sharesTopic(query, source))
          .map((source, index) => ({ ...source, n: index + 1, marker: `S${index + 1}` }));
      }
      const raw = await completeMetered(
        slots.llm,
        user,
        {
          messages: [
            {
              role: 'system',
              content: body.length === 'conclude'
                ? concludeSystemPrompt(body.language, writerText.includes('[[CITATION_'))
                : completeSystemPrompt(body.language, writerText.includes('[[CITATION_'), body.length),
            },
            {
              role: 'user',
              content: completeUserPrompt({
                documentTitle: body.document_title,
                sectionTitle: body.section_title,
                sources: sourcesPrompt(sources),
                refine: body.refine,
                before: body.before,
                after: body.after,
                outline: body.length === 'conclude' ? body.outline : undefined,
              }),
            },
          ],
          temperature: 0.6,
          maxTokens: body.length === 'sentence' ? 90 : body.length === 'conclude' ? 320 : 260,
          json: body.length === 'conclude',
        },
        { feature: body.length === 'paragraph' ? 'ai-suggest' : body.length === 'conclude' ? 'ai-conclude' : 'autocomplete' },
      );
      // Conclude answers {"text", "next_heading", "title"}; the others plain text.
      const concluded = body.length === 'conclude' ? extractJsonObject(raw) : null;
      const normalize = (value: string) => value.toLowerCase().replace(/^[\d.\s]+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const proposedRaw = concluded ? concluded.next_heading ?? concluded.nextHeading ?? concluded.heading ?? concluded.next_section ?? '' : '';
      const proposed = concluded && concluded.final_section !== true ? String(proposedRaw || '').replace(/^#+\s*/, '').trim().slice(0, 160) : '';
      // A new heading only at the end of the document, and never one the outline already has.
      const heading =
        proposed && !body.next_section_exists && !body.outline.some((existing) => normalize(existing) === normalize(proposed)) ? proposed : null;
      const untitled = !body.document_title || /^untitled/i.test(body.document_title.trim());
      const title = concluded && untitled ? String(concluded.title || '').trim().slice(0, 200) || null : null;
      let text = dropInventedMarkers(String(concluded ? concluded.text ?? '' : raw || '').trimEnd(), sources, writerText);
      // Mid-paragraph: models sometimes run on into the text that already follows the cursor.
      text = cutRepeatedFollowingText(text, body.after);
      // The model often drops the space between the writer's last word and its continuation.
      const last = body.before.slice(-1);
      if (text && !/^\s/.test(text) && (/^[\p{L}\p{N}]$/u.test(last) || '.,;:!?)'.includes(last)) && (/^[\p{L}\p{N}]/u.test(text) || '(['.includes(text[0]))) {
        text = ` ${text}`;
      }
      return c.json({ text, sources: usedSources(text, sources), ms: Date.now() - started, ...(body.length === 'conclude' ? { heading, title } : {}) });
    });
  });

  // ---------------------------------------------------------------- review comments

  /** Reviewer comments (Minor/Major) anchored to exact quotes in the writer's blocks. */
  app.post('/review', async (c) => {
    const user = currentUser(c);
    const body = await parseBody(c, ReviewRequest);
    const reviewable = body.blocks.filter((block) => block.text.trim());
    if (!reviewable.length) return c.json({ comments: [] });
    const mode = REVIEW_MODES[body.mode];
    const perChunk = body.scope === 'block' ? 5 : body.mode === 'general' ? 12 : 20;
    const system =
      body.mode === 'claims' ? claimCheckSystemPrompt(body.language)
      : body.mode === 'proofread' ? proofreadSystemPrompt(body.language)
      : body.mode === 'tone' ? toneSystemPrompt(body.tone || 'formal, precise academic prose', body.language)
      : reviewCommentsSystemPrompt(body.language);

    const reviewChunk = async (chunk: ReviewBlock[]) => {
      const raw = await completeMetered(
        slots.llm,
        user,
        {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: reviewCommentsUserPrompt({ documentTitle: body.document_title, focus: body.focus, perChunk, blocks: chunk }) },
          ],
          task: 'review',
          temperature: 0.3,
          maxTokens: 2500,
        },
        { feature: mode.feature, reviewWords: chunk.reduce((sum, block) => sum + countWords(block.text), 0) },
      );
      const texts = new Map(chunk.map((block) => [block.id, block.text]));
      const payload = parseJsonPayload(raw);
      const comments = [];
      for (const item of Array.isArray(payload) ? payload : []) {
        if (!item || typeof item !== 'object' || !texts.has((item as any).block_id)) continue;
        const entry = item as Record<string, unknown>;
        const blockId = String(entry.block_id);
        const quote = locateQuote(String(entry.quote ?? ''), texts.get(blockId)!);
        const comment = String(entry.comment ?? '').trim();
        if (!quote || !comment || quote.includes('[[CITATION_')) continue;
        const raw = String(entry.category || mode.fallback).toLowerCase().replace(/[\s-]+/g, '_');
        const category = mode.categories.has(raw) ? raw : mode.fallback;
        const suggestion = String(entry.suggestion || '').trim();
        comments.push({
          id: `ai-${newId().slice(0, 12)}`,
          blockId,
          quote,
          comment: comment.slice(0, 1200),
          severity: String(entry.severity).toLowerCase() === 'major' ? 'major' : 'minor',
          category,
          // A rewrite may keep the quote's own citations but never invent new placeholders.
          suggestion: suggestion && suggestion !== quote && mode.suggestions.has(category) ? dropInventedMarkers(suggestion, [], quote).slice(0, 2000) || null : null,
        });
      }
      return comments.slice(0, perChunk);
    };

    // At most three chunks at a time.
    const chunks = reviewChunks(reviewable);
    const results: PromiseSettledResult<Awaited<ReturnType<typeof reviewChunk>>>[] = new Array(chunks.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, chunks.length) }, async () => {
        while (next < chunks.length) {
          const index = next++;
          try {
            results[index] = { status: 'fulfilled', value: await reviewChunk(chunks[index]) };
          } catch (reason) {
            results[index] = { status: 'rejected', reason };
          }
        }
      }),
    );
    const comments = [];
    for (const result of results) {
      if (result.status === 'rejected') {
        if (isBlockingLlmError(result.reason) || result.reason instanceof HTTPException) throw toHttpError(result.reason);
        console.warn('editor review chunk failed:', (result.reason as Error)?.message);
        continue;
      }
      comments.push(...result.value);
    }
    const order = new Map(reviewable.map((block, index) => [block.id, index]));
    const blockText = new Map(body.blocks.map((block) => [block.id, block.text]));
    comments.sort(
      (a, b) =>
        (order.get(a.blockId) ?? 0) - (order.get(b.blockId) ?? 0) ||
        (blockText.get(a.blockId) ?? '').indexOf(a.quote) - (blockText.get(b.blockId) ?? '').indexOf(b.quote),
    );
    if (!comments.length && results.some((result) => result.status === 'rejected')) {
      throw new HTTPException(502, { message: 'The review could not be completed; try again' });
    }
    return c.json({ comments });
  });

  /** Peer review: a referee report on the whole manuscript (Markdown), with its recommendation. */
  app.post('/peer-review', async (c) => {
    const user = currentUser(c);
    const body = await parseBody(c, PeerReviewRequest);
    // About 15k words: whole theses are reviewed from their first chapters.
    const text = body.text.slice(0, 90_000);
    if (countWords(text) < 80) throw new HTTPException(422, { message: 'Write a little more first: the review needs at least a few paragraphs.' });
    return withHttpErrors(async () => {
      const report = await completeMetered(
        slots.llm,
        user,
        {
          messages: [
            { role: 'system', content: peerReviewSystemPrompt(body.language) },
            { role: 'user', content: peerReviewUserPrompt({ documentTitle: body.document_title, field: body.field, text }) },
          ],
          task: 'review',
          temperature: 0.3,
          maxTokens: 3500,
        },
        { feature: 'peer-review', reviewWords: countWords(text) },
      );
      const cleaned = (report || '').trim();
      const recommendation = /Recommendation:\s*\**\s*(Accept|Minor revision|Major revision|Reject)/i.exec(cleaned)?.[1] ?? null;
      return c.json({ report: cleaned, recommendation, reviewedWords: countWords(text), truncated: text.length < body.text.length });
    });
  });

  /**
   * Source quality: each cited work looked up by DOI (or title) in the papers index, flagged when it
   * is retracted, a preprint, cannot be found, or its DOI points to a different title.
   */
  app.post('/source-quality', async (c) => {
    const user = currentUser(c);
    const body = await parseBody(c, SourceQualityRequest);
    const check = async (source: z.output<typeof SourceQualityRequest>['sources'][number]) => {
      const title = (source.title || '').trim();
      let paper: Awaited<ReturnType<typeof slots.papers.lookupDoi>> = null;
      try {
        if (source.doi) paper = await slots.papers.lookupDoi(source.doi);
        if (!paper && title) {
          const found = await slots.papers.search({ query: title.slice(0, 250), limit: 3 });
          paper = found.find((candidate) => titleSimilarity(candidate.title, title) >= 0.7) ?? null;
        }
      } catch (error) {
        if (error instanceof PapersError) return { key: source.key, status: 'error' as const, flags: [], paper: null };
        throw error;
      }
      const flags: { kind: string; label: string }[] = [];
      if (!paper) flags.push({ kind: 'not_found', label: source.doi ? 'DOI not found' : 'Not found in 250M+ papers' });
      else {
        if ((paper as { is_retracted?: boolean }).is_retracted) flags.push({ kind: 'retracted', label: 'Retracted' });
        if (/preprint|posted-content/i.test(paper.type || '')) flags.push({ kind: 'preprint', label: 'Preprint (not peer reviewed)' });
        if (title && source.doi && titleSimilarity(paper.title, title) < 0.5) flags.push({ kind: 'mismatch', label: 'DOI points to a different title' });
        const year = Number(source.year) || paper.year;
        if (year && year < new Date().getFullYear() - 20) flags.push({ kind: 'old', label: `Over 20 years old (${year})` });
      }
      const serious = flags.some((flag) => ['not_found', 'retracted', 'mismatch'].includes(flag.kind));
      return {
        key: source.key,
        status: serious ? ('problem' as const) : flags.length ? ('warning' as const) : ('ok' as const),
        flags,
        paper: paper ? { title: paper.title, year: paper.year, venue: paper.venue, doi: paper.doi, cited_by_count: paper.cited_by_count } : null,
      };
    };
    const results: Awaited<ReturnType<typeof check>>[] = new Array(body.sources.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, body.sources.length) }, async () => {
        while (next < body.sources.length) {
          const index = next++;
          results[index] = await check(body.sources[index]);
        }
      }),
    );
    await meterReferenceChecks(user, body.sources.length, { feature: 'source-quality' });
    return c.json({ results });
  });

  /** The AI answers in a comment thread (the writer asked it something with @AI). */
  app.post('/comment-reply', async (c) => {
    const user = currentUser(c);
    const body = await parseBody(c, CommentReplyRequest);
    const thread = body.thread
      .slice(-12)
      .map((message) => `${String(message.author || 'Writer').slice(0, 80)}: ${String(message.text || '').slice(0, 1500)}`)
      .join('\n');
    return withHttpErrors(async () => {
      const text = await completeMetered(
        slots.llm,
        user,
        {
          messages: [
            { role: 'system', content: commentReplySystemPrompt(body.language) },
            { role: 'user', content: commentReplyUserPrompt({ documentTitle: body.document_title, blockText: body.block_text, quote: body.quote, thread, question: body.question }) },
          ],
          temperature: 0.4,
          maxTokens: 500,
        },
        { feature: 'comment-reply' },
      );
      return c.json({ text: (text || '').trim() });
    });
  });

  // ---------------------------------------------------------------- chat

  /** A document's threads; without document_id, the writer's standalone AI Chat threads. */
  app.get('/chats', async (c) => {
    const user = currentUser(c);
    const query = parseQuery(c, z.object({ document_id: z.string().max(64).optional() }));
    const documentId = query.document_id || null;
    if (documentId) await resolveAccess(documentId, user);
    const threads = await listChatThreads(user.id, documentId);
    return c.json({ chats: threads.map((thread) => threadSummary(thread, thread.message_count)) });
  });

  app.get('/chats/:threadId', async (c) => {
    const user = currentUser(c);
    const thread = await getChatThread(c.req.param('threadId'), user.id);
    if (!thread) throw new HTTPException(404, { message: 'Chat not found' });
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    return c.json({ ...threadSummary(thread, messages.length), messages });
  });

  app.delete('/chats/:threadId', async (c) => {
    const user = currentUser(c);
    if (!(await deleteChatThread(c.req.param('threadId'), user.id))) throw new HTTPException(404, { message: 'Chat not found' });
    return c.json({ success: true });
  });

  /** Streams an answer (Server-Sent Events: sources, delta..., done) and keeps the thread. */
  app.post('/chat', async (c) => {
    const user = currentUser(c);
    const body = await parseBody(c, ChatRequest);
    const documentId = body.document_id;
    if (documentId) await resolveAccess(documentId, user);
    const unavailable = llmUnavailable(slots.llm);
    if (unavailable) throw new HTTPException(503, { message: unavailable });

    let thread;
    if (body.thread_id) {
      thread = await getChatThread(body.thread_id, user.id);
      if (!thread || (thread.document_id ?? null) !== documentId) throw new HTTPException(404, { message: 'Chat not found' });
    } else {
      thread = await createChatThread(documentId, user.id, body.message.trim().split('\n')[0].slice(0, 80) || 'New chat');
    }
    const threadId = thread.id;
    const history = (Array.isArray(thread.messages) ? thread.messages : []).filter((message) => message.role === 'user' || message.role === 'assistant').slice(-12);

    const abort = new AbortController();
    c.req.raw.signal?.addEventListener('abort', () => abort.abort(), { once: true });
    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(sse(event, data)));
          } catch {
            closed = true;
          }
        };
        try {
          const sources = await gatherSources(slots, user, {
            query: queryFromText(`${body.message} ${body.selection || ''}`),
            useWeb: body.use_web,
            useLibrary: body.use_library,
            libraryDocumentIds: body.library_document_ids,
          });
          send('sources', { threadId, sources });
          const messages: ChatMessage[] = [
            { role: 'system', content: chatSystemPrompt(body.language, !documentId) },
            {
              role: 'system',
              content: chatContextPrompt({
                useDocument: Boolean(documentId) && body.use_document,
                documentTitle: body.document_title,
                documentText: body.document_text,
                selection: body.selection,
                sources: sourcesPrompt(sources),
              }),
            },
            ...history.map((message): ChatMessage => ({ role: message.role, content: String(message.content ?? '').slice(0, 6000) })),
            { role: 'user', content: body.message },
          ];

          let answer = '';
          let usage: LlmUsage | null = null;
          try {
            const result = await slots.llm.stream({ messages, task: 'fast', maxTokens: 1800, temperature: 0.4, signal: abort.signal }, (delta) => {
              answer += delta;
              send('delta', { text: delta });
            });
            usage = result.usage;
          } catch (error) {
            if (!abort.signal.aborted) {
              console.warn('editor chat stream failed:', (error as Error).message);
              send(
                'error',
                error instanceof LlmError && error.code !== 'upstream'
                  ? { status: error.status, detail: error.message }
                  : { status: 502, detail: 'The answer was interrupted; try again' },
              );
            }
            if (!answer || abort.signal.aborted) {
              if (answer) await meterTokens(user, estimated(messages, answer), meteringInfo());
              return;
            }
          }
          await meterTokens(user, usage ?? estimated(messages, answer), meteringInfo());

          const now = new Date().toISOString();
          const userMessage: StoredChatMessage = {
            id: newId(),
            role: 'user',
            content: body.message,
            createdAt: now,
            ...(body.selection ? { selection: body.selection.slice(0, 2000) } : {}),
          };
          const assistantMessage: StoredChatMessage = { id: newId(), role: 'assistant', content: answer, sources: usedSources(answer, sources), createdAt: now };
          await appendChatMessages(threadId, [userMessage, assistantMessage]);
          send('done', { threadId, message: assistantMessage });
        } catch (error) {
          console.error('editor chat failed:', error);
          send('error', { status: 500, detail: 'The chat stopped. Try again.' });
        } finally {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        }
      },
      cancel() {
        closed = true;
        abort.abort();
      },
    });

    function meteringInfo() {
      return { feature: 'chat', provider: slots.llm.provider, model: llmModelName(slots.llm, 'fast') };
    }

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  });

  return app;
}

function estimated(messages: ChatMessage[], answer: string): LlmUsage {
  return { inputTokens: messages.reduce((sum, message) => sum + estimateTokens(message.content), 0), outputTokens: estimateTokens(answer) };
}
