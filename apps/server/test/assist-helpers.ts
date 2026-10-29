/** Fakes shared by the assist route tests: slots without network, an app without a database. */
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppVariables, AuthUser } from '../src/auth.js';
import type { ChatMessage, LlmSlot, Paper, PapersSlot, Slots } from '../src/slots/types.js';
import { assistRoutes } from '../src/routes/assist.js';
import { reviewRoutes } from '../src/routes/review.js';
import { generateRoutes } from '../src/routes/generate.js';

export const USER: AuthUser = { id: '11111111-1111-4111-8111-111111111111', email: 'writer@example.com', full_name: 'Writer', account_id: '22222222-2222-4222-8222-222222222222', is_admin: false };

type Reply = string | ((messages: ChatMessage[]) => string);

export type FakeLlm = LlmSlot & { calls: { messages: ChatMessage[]; task?: string; maxTokens?: number; json?: boolean }[] };

/** An LLM slot that answers `reply` (or throws `error`); streams the reply in 3 pieces. */
export function fakeLlm(reply: Reply, error?: Error): FakeLlm {
  const calls: FakeLlm['calls'] = [];
  const answer = (messages: ChatMessage[]) => (typeof reply === 'function' ? reply(messages) : reply);
  return {
    provider: 'fake',
    calls,
    async complete(input) {
      calls.push(input);
      if (error) throw error;
      return { text: answer(input.messages), usage: { inputTokens: 100, outputTokens: 20 } };
    },
    async stream(input, onDelta) {
      calls.push(input);
      if (error) throw error;
      const text = answer(input.messages);
      const third = Math.ceil(text.length / 3);
      for (let index = 0; index < text.length; index += third) onDelta(text.slice(index, index + third));
      return { text, usage: { inputTokens: 100, outputTokens: 20 } };
    },
  };
}

export function paper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'W1',
    title: 'Sleep and memory consolidation',
    authors: [{ name: 'Jane Smith' }, { name: 'Ali Khan' }],
    year: 2020,
    venue: 'Nature Neuroscience',
    doi: '10.1000/sleep.1',
    abstract: 'Sleep helps memory.',
    cited_by_count: 50,
    is_oa: true,
    oa_url: 'https://example.org/sleep',
    pdf_url: null,
    type: 'article',
    ...overrides,
  };
}

export type FakePapers = PapersSlot & { queries: string[] };

/** A plain papers slot (no paging): every search returns `papers`. */
export function fakePapers(papers: Paper[] = [paper()], lookup: Paper | null = paper()): FakePapers {
  const queries: string[] = [];
  return {
    provider: 'fake-papers',
    queries,
    async search(input) {
      queries.push(input.query);
      return papers;
    },
    async lookupDoi() {
      return lookup;
    },
  };
}

/** A Response whose JSON body is untyped (Node types it as unknown). */
export type TestResponse = Omit<Response, 'json'> & { json(): Promise<any> };
export type TestApp = { request(path: string, init?: RequestInit): Promise<TestResponse> };

export function makeApp(slots: Slots, user: AuthUser | null = USER): TestApp {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/ai-editor/assist', assistRoutes(slots));
  app.route('/api/ai-editor', reviewRoutes(slots));
  app.route('/api/editor', generateRoutes(slots));
  // Same error answer as app.ts.
  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ detail: error.message }, error.status);
    console.error(error);
    return c.json({ detail: 'Something went wrong on our side.' }, 500);
  });
  return { request: async (path, init) => (await app.request(path, init)) as TestResponse };
}

export const post = (app: TestApp, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Server-Sent Events -> [{event, data}]. */
export function parseSse(text: string): { event: string; data: any }[] {
  return text
    .split('\n\n')
    .filter((chunk) => chunk.trim())
    .map((chunk) => ({
      event: /^event: (.+)$/m.exec(chunk)?.[1] ?? '',
      data: JSON.parse(chunk.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n')),
    }));
}
