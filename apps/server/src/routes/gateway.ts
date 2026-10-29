import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { randomUUID } from 'node:crypto';
import { env } from '../env.js';
import { findApiKey, type ApiKeyRow } from '../lib/apiKeys.js';
import { settings } from '../lib/settings.js';
import { resolveLlmConfig } from '../slots/llm.js';
import { billingMode } from '../lib/stripeBilling.js';
import { assertCanSpend, charge, wallet, CreditsError } from '../lib/credits.js';
import type { ServiceName } from '../lib/prices.js';
import type { Slots } from '../slots/types.js';
import { peerReviewSystemPrompt, peerReviewUserPrompt } from '../lib/prompts.js';
import { z } from 'zod';

type GatewayVars = { apiKey: ApiKeyRow };
type GatewayContext = Context<{ Variables: GatewayVars }>;

/**
 * Videmak Cloud gateway (/v1): one Videmak key unlocks every paid service. Each call is checked
 * against the account's credits before it runs and charged after it succeeds.
 *
 *   /v1/chat/completions        AI (OpenAI-compatible, DeepSeek)
 *   /v1/oa/…                    Scholar metadata: works, authors, sources… (OpenAlex shape)
 *   /v1/files/…                 Scholar full text and PDFs (CEDOA)
 *   /v1/research/tools[/name]   Scholar research tools as JSON
 *   /v1/mcp                     the same tools over MCP (Streamable HTTP)
 *   /v1/review                  a structured peer review of a manuscript
 *   /v1/convert                 editor blocks to Word, PDF or a LaTeX project
 *   /v1/credits                 the key's balance and free credits left today
 */

/** Scholar research tools that keep per-account state (systematic reviews, cache): not shared through one gateway account. */
const ACCOUNT_TOOLS = new Set([
  'cache_manage', 'create_review', 'reviews', 'delete_review', 'set_active_review', 'update_paper_status',
  'get_review_papers', 'add_papers_to_review', 'snowball_search', 'export_review', 'prisma_counts',
]);

/** Calls per key per second for metadata and files, and research tool calls a key may run at once. */
const PER_KEY_PER_SECOND = 50;
const PER_KEY_RESEARCH = 4;

const scholarKey = () => settings().cloudScholarKey;
const scholarBase = () => settings().scholarUrl;

const windows = new Map<string, { count: number; resetAt: number }>();
const research = new Map<string, number>();

function throttle(c: GatewayContext) {
  const id = c.get('apiKey').id;
  const now = Date.now();
  const current = windows.get(id);
  if (!current || current.resetAt < now) windows.set(id, { count: 1, resetAt: now + 1000 });
  else if (++current.count > PER_KEY_PER_SECOND) {
    c.header('Retry-After', '1');
    throw new HTTPException(429, { message: `Slow down: up to ${PER_KEY_PER_SECOND} requests a second per key.` });
  }
  if (windows.size > 50_000) windows.clear();
}

async function withResearchSlot<T>(c: GatewayContext, work: () => Promise<T>): Promise<T> {
  const id = c.get('apiKey').id;
  const running = research.get(id) ?? 0;
  if (running >= PER_KEY_RESEARCH) {
    c.header('Retry-After', '2');
    throw new HTTPException(429, { message: `Up to ${PER_KEY_RESEARCH} research tool calls at once per key.` });
  }
  research.set(id, running + 1);
  try {
    return await work();
  } finally {
    const left = (research.get(id) ?? 1) - 1;
    if (left > 0) research.set(id, left); else research.delete(id);
  }
}

/** Upstream headers worth passing on (never the upstream's own rate limits or cookies). */
const PASS_HEADERS = ['content-type', 'content-disposition', 'content-length', 'cache-control', 'etag', 'last-modified', 'location'];

function passHeaders(upstream: Response, extra: Record<string, string> = {}) {
  const headers = new Headers();
  for (const name of PASS_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

export function gatewayRoutes(slots: Slots) {
  const app = new Hono<{ Variables: GatewayVars }>();

  app.use('*', async (c, next) => {
    const header = c.req.header('authorization') || '';
    const key = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const apiKey = key ? await findApiKey(key) : null;
    if (!apiKey) throw new HTTPException(401, { message: 'Missing or invalid Videmak API key. Create one at /developers/keys.' });
    // Keys made while payments were in test mode stop working once real payments start.
    if (apiKey.mode !== billingMode()) throw new HTTPException(401, { message: `This is a ${apiKey.mode} key; create a new key for ${billingMode()} use.` });
    c.set('apiKey', apiKey);
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof CreditsError) return c.json({ error: { message: error.message, code: error.code } }, 402);
    if (error instanceof HTTPException) return c.json({ error: { message: error.message } }, error.status);
    console.error('gateway error', error);
    return c.json({ error: { message: 'Something went wrong on our side.' } }, 500);
  });

  const can = (c: GatewayContext, service: ServiceName) => assertCanSpend(c.get('apiKey').account_id, service, c.get('apiKey'));
  const bill = async (c: GatewayContext, service: ServiceName, quantity: number, requestId: string, metadata?: Record<string, unknown>) => {
    const result = await charge({ accountId: c.get('apiKey').account_id, apiKeyId: c.get('apiKey').id, service, quantity, requestId, metadata });
    return result;
  };
  const creditHeaders = (result: Awaited<ReturnType<typeof bill>>): Record<string, string> =>
    result ? { 'X-Credits-Charged': String(Math.round((result.free + result.paid) * 1000) / 1000), 'X-Credits-Balance': String(Math.round(result.balance * 1000) / 1000) } : {};

  app.get('/credits', async (c) => c.json(await wallet(c.get('apiKey').account_id)));

  // ---------------------------------------------------------------- AI

  /** OpenAI-compatible chat completions, served by DeepSeek. Streams are passed through and charged from their usage chunk. */
  app.post('/chat/completions', async (c) => {
    // A dedicated upstream key, else the app's own key when the app itself runs on DeepSeek's API.
    const llm = resolveLlmConfig(settings());
    const upstreamKey = settings().cloudDeepseekKey || (llm.provider === 'deepseek' && llm.baseURL === 'https://api.deepseek.com' ? llm.apiKey : '');
    if (!upstreamKey) throw new HTTPException(503, { message: 'AI is not available on this gateway yet.' });
    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.messages)) throw new HTTPException(422, { message: 'messages is required.' });
    await can(c, 'llm_output_tokens');
    const model = body.model === 'deepseek-reasoner' ? 'deepseek-reasoner' : 'deepseek-chat';
    const requestId = randomUUID();
    const upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${upstreamKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, model, ...(body.stream ? { stream_options: { include_usage: true } } : {}) }),
      signal: AbortSignal.timeout(300_000),
    });
    type Usage = { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number };
    const chargeUsage = async (usage: Usage) => {
      const cached = usage.prompt_cache_hit_tokens || 0;
      await bill(c, 'llm_input_tokens', Math.max(0, (usage.prompt_tokens || 0) - cached), requestId, { model });
      if (cached) await bill(c, 'llm_cached_tokens', cached, requestId, { model });
      return bill(c, 'llm_output_tokens', usage.completion_tokens || 0, requestId, { model });
    };
    if (!body.stream || !upstream.body) {
      const json: any = await upstream.json().catch(() => ({}));
      const charged = upstream.ok && json?.usage ? await chargeUsage(json.usage) : null;
      for (const [name, value] of Object.entries(creditHeaders(charged))) c.header(name, value);
      return c.json(json, upstream.status as any);
    }
    // Pass the stream through untouched while reading its final usage chunk.
    const decoder = new TextDecoder();
    let buffer = '';
    let usage: Usage | null = null;
    const stream = upstream.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
          try { const data = JSON.parse(line.slice(6)); if (data.usage) usage = data.usage; } catch { /* partial line */ }
        }
      },
      async flush() {
        if (usage) await chargeUsage(usage).catch((error) => console.error('AI charge failed', requestId, error));
      },
    }));
    return new Response(stream, { status: upstream.status, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  });

  app.get('/models', (c) => c.json({ object: 'list', data: ['deepseek-chat', 'deepseek-reasoner'].map((id) => ({ id, object: 'model', owned_by: 'videmak' })) }));

  // ---------------------------------------------------------------- Scholar: metadata and files

  /** Forwards a Scholar request with the gateway's own key; charges one credit when it succeeds. */
  async function scholar(c: GatewayContext, service: 'papers_requests' | 'files_requests', path: string, init: RequestInit = {}) {
    throttle(c);
    await can(c, service);
    const url = new URL(`${scholarBase()}${path}`);
    new URL(c.req.url).searchParams.forEach((value, key) => { if (key !== 'api_key') url.searchParams.set(key, value); });
    const upstream = await fetch(url, {
      ...init,
      redirect: 'manual', // an external PDF link comes back as a redirect: hand it on, never send our key there
      headers: { Authorization: `Bearer ${scholarKey()}`, Accept: c.req.header('accept') || '*/*', ...(init.headers || {}) },
      signal: AbortSignal.timeout(60_000),
    });
    const ok = upstream.status >= 200 && upstream.status < 400 && upstream.status !== 304;
    const charged = ok ? await bill(c, service, 1, randomUUID(), { path }) : null;
    if (upstream.status === 429 || upstream.status >= 500) {
      // The upstream's limits are ours to manage: tell the caller to retry, without Scholar's details.
      await upstream.body?.cancel();
      c.header('Retry-After', '5');
      throw new HTTPException(503, { message: 'Papers are busy right now. Retry in a few seconds.' });
    }
    return new Response(upstream.body, { status: upstream.status, headers: passHeaders(upstream, creditHeaders(charged)) });
  }

  /** Without a Scholar key the gateway still answers work searches from public OpenAlex (same shape). */
  async function openalex(c: GatewayContext, path: string) {
    throttle(c);
    await can(c, 'papers_requests');
    const url = new URL(`${env.cloudPapersUrl}${path}`);
    new URL(c.req.url).searchParams.forEach((value, key) => { if (key !== 'api_key') url.searchParams.set(key, value); });
    url.searchParams.set('mailto', settings().openalexEmail);
    const upstream = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const json = await upstream.json().catch(() => ({}));
    const charged = upstream.ok ? await bill(c, 'papers_requests', 1, randomUUID(), { path, upstream: 'openalex' }) : null;
    for (const [name, value] of Object.entries(creditHeaders(charged))) c.header(name, value);
    return c.json(json, upstream.status as any);
  }

  const restOf = (c: GatewayContext, prefix: string) => {
    const path = new URL(c.req.url).pathname;
    const index = path.indexOf(prefix);
    return index >= 0 ? path.slice(index + prefix.length) : '';
  };

  app.post('/oa/works/bulk', async (c) => {
    if (!scholarKey()) throw new HTTPException(503, { message: 'Bulk lookups need the Scholar upstream on this gateway.' });
    return scholar(c, 'papers_requests', '/v1/oa/works/bulk', { method: 'POST', body: await c.req.text(), headers: { 'Content-Type': 'application/json' } });
  });
  app.get('/oa/*', async (c) => {
    const rest = restOf(c, '/v1/oa');
    if (!/^\/[A-Za-z0-9_:./%-]*$/.test(rest) || rest.includes('..')) throw new HTTPException(404, { message: 'Not found' });
    if (scholarKey()) return scholar(c, 'papers_requests', `/v1/oa${rest}`);
    if (rest === '/works' || rest.startsWith('/works/')) return openalex(c, rest);
    throw new HTTPException(503, { message: 'This lookup needs the Scholar upstream on this gateway.' });
  });

  app.get('/files/*', async (c) => {
    if (!scholarKey()) throw new HTTPException(503, { message: 'Full text needs the Scholar upstream on this gateway.' });
    const rest = restOf(c, '/v1/files');
    if (!/^\/(list|search|stats|manifest\/[\w.-]+|text\/[\w.-]+|texts\/[\w.,-]+|xml\/[\w.-]+|pdf\/[\w.-]+)?$/.test(rest)) throw new HTTPException(404, { message: 'Not found' });
    return scholar(c, 'files_requests', `/v1/research-corpus${rest}`);
  });

  // ---------------------------------------------------------------- Scholar: research tools and MCP

  /** Credits for one tool call: one per reference checked, else one per call. */
  const toolCost = (name: string, args: any): { service: ServiceName; quantity: number } => {
    if (name === 'validate_citations') {
      const ids = Array.isArray(args?.identifiers) ? args.identifiers.length : String(args?.identifiers ?? '').split(/[\s,;]+/).filter(Boolean).length;
      return { service: 'reference_checks', quantity: Math.max(1, ids) };
    }
    return { service: 'research_calls', quantity: 1 };
  };

  const researchHeaders = () => ({ Authorization: `Bearer ${scholarKey()}`, 'Content-Type': 'application/json', Accept: 'application/json' });

  app.get('/research/tools', async (c) => {
    if (!scholarKey()) throw new HTTPException(503, { message: 'Research tools need the Scholar upstream on this gateway.' });
    throttle(c);
    const upstream = await fetch(`${scholarBase()}/api/v1/research/tools`, { headers: researchHeaders(), signal: AbortSignal.timeout(30_000) });
    const json: any = await upstream.json().catch(() => ({}));
    if (Array.isArray(json.tools)) {
      json.tools = json.tools.filter((tool: { name: string }) => !ACCOUNT_TOOLS.has(tool.name));
      json.tool_count = json.tools.length;
      json.name = 'Videmak research tools';
    }
    return c.json(json, upstream.status as any);
  });

  app.post('/research/tools/:name', async (c) => {
    if (!scholarKey()) throw new HTTPException(503, { message: 'Research tools need the Scholar upstream on this gateway.' });
    const name = c.req.param('name');
    if (!/^[a-z_]{2,40}$/.test(name) || ACCOUNT_TOOLS.has(name)) throw new HTTPException(404, { message: `No tool named ${name}.` });
    const args = await c.req.json().catch(() => ({}));
    const cost = toolCost(name, args);
    await can(c, cost.service);
    return withResearchSlot(c, async () => {
      const upstream = await fetch(`${scholarBase()}/api/v1/research/tools/${name}`, {
        method: 'POST', headers: researchHeaders(), body: JSON.stringify(args ?? {}), signal: AbortSignal.timeout(120_000),
      });
      const json: any = await upstream.json().catch(() => ({ isError: true, content: [{ type: 'text', text: 'Bad response from research tools.' }] }));
      const charged = upstream.ok && !json?.isError ? await bill(c, cost.service, cost.quantity, randomUUID(), { tool: name }) : null;
      for (const [header, value] of Object.entries(creditHeaders(charged))) c.header(header, value);
      return c.json(json, upstream.status as any);
    });
  });

  /**
   * MCP over Streamable HTTP (stateless, JSON responses). Tool calls are charged like the JSON
   * API; tools that keep per-account state are hidden from the list and refused.
   */
  app.post('/mcp', async (c) => {
    if (!scholarKey()) throw new HTTPException(503, { message: 'Research tools need the Scholar upstream on this gateway.' });
    throttle(c);
    const message: any = await c.req.json().catch(() => null);
    if (!message || Array.isArray(message) || message.jsonrpc !== '2.0') {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Send one JSON-RPC 2.0 message per request.' } }, 400);
    }
    const rpcError = (code: number, text: string) => c.json({ jsonrpc: '2.0', id: message.id ?? null, error: { code, message: text } });
    const isCall = message.method === 'tools/call';
    const name = isCall ? String(message.params?.name ?? '') : '';
    if (isCall && ACCOUNT_TOOLS.has(name)) return rpcError(-32602, `Tool ${name} is not available through Videmak Cloud.`);
    const cost = isCall ? toolCost(name, message.params?.arguments) : null;
    if (cost) {
      try { await can(c, cost.service); } catch (error) {
        if (error instanceof CreditsError) return rpcError(-32002, error.message);
        throw error;
      }
    }
    const forward = async () => {
      const upstream = await fetch(`${scholarBase()}/api/v1/research/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${scholarKey()}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(120_000),
      });
      if (upstream.status === 202 || upstream.status === 204) return new Response(null, { status: upstream.status });
      const text = await upstream.text();
      // The upstream may answer as one server-sent event; the reply is its data line.
      const data = (upstream.headers.get('content-type') || '').includes('text/event-stream')
        ? text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).pop() || '{}'
        : text || '{}';
      let reply: any;
      try { reply = JSON.parse(data); } catch { return rpcError(-32603, 'Bad response from research tools.'); }
      if (message.method === 'tools/list' && Array.isArray(reply?.result?.tools)) {
        reply.result.tools = reply.result.tools.filter((tool: { name: string }) => !ACCOUNT_TOOLS.has(tool.name));
      }
      if (message.method === 'initialize' && reply?.result?.serverInfo) reply.result.serverInfo = { ...reply.result.serverInfo, name: 'videmak-research' };
      if (cost && upstream.ok && reply?.result && !reply.result.isError) {
        const charged = await bill(c, cost.service, cost.quantity, randomUUID(), { tool: name, via: 'mcp' });
        for (const [header, value] of Object.entries(creditHeaders(charged))) c.header(header, value);
      }
      return c.json(reply, upstream.ok ? 200 : (upstream.status as any));
    };
    return isCall ? withResearchSlot(c, forward) : forward();
  });
  // ---------------------------------------------------------------- review and files

  const reviewBody = z.object({
    text: z.string().min(1).max(200_000),
    title: z.string().max(500).optional(),
    field: z.string().max(200).optional(),
    language: z.string().max(10).optional(),
  });

  /** The editor's peer review: strengths, problems by severity and a recommendation. Charged per 1,000 words read. */
  app.post('/review', async (c) => {
    const parsed = reviewBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(422, { message: 'Send {"text": "…"} with the manuscript text (optional: title, field, language).' });
    const text = parsed.data.text.slice(0, 90_000);
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words < 80) throw new HTTPException(422, { message: 'The text is too short to review: send at least a few paragraphs.' });
    await can(c, 'review_words');
    const result = await slots.llm.complete({
      messages: [
        { role: 'system', content: peerReviewSystemPrompt(parsed.data.language) },
        { role: 'user', content: peerReviewUserPrompt({ documentTitle: parsed.data.title, field: parsed.data.field, text }) },
      ],
      task: 'review', temperature: 0.3, maxTokens: 3500,
    }).catch((error: Error) => { throw new HTTPException(503, { message: `The reviewer is not available right now (${error.message.slice(0, 120)}).` }); });
    const report = (result.text || '').trim();
    const charged = await bill(c, 'review_words', words, randomUUID(), { feature: 'review' });
    for (const [header, value] of Object.entries(creditHeaders(charged))) c.header(header, value);
    const recommendation = /Recommendation:\s*\**\s*(Accept|Minor revision|Major revision|Reject)/i.exec(report)?.[1] ?? null;
    return c.json({ report, recommendation, reviewed_words: words, truncated: text.length < parsed.data.text.length });
  });

  const convertBody = z.object({
    title: z.string().max(500).default('Untitled document'),
    blocks: z.array(z.any()).min(1).max(20_000),
    format: z.enum(['docx', 'pdf', 'latex']).default('docx'),
    settings: z.record(z.any()).nullable().optional(),
  });

  /** Editor blocks (@videmak/editor's document JSON) as a .docx, a PDF or a zipped LaTeX project. */
  app.post('/convert', async (c) => {
    const parsed = convertBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(422, { message: 'Send {"blocks": […], "format": "docx" | "pdf" | "latex"} (optional: title, settings).' });
    await can(c, 'conversions');
    const form = new FormData();
    form.append('payload', JSON.stringify({ title: parsed.data.title, blocks: parsed.data.blocks, comments: [], settings: parsed.data.settings || {}, format: parsed.data.format, author: '' }));
    const response = await fetch(`${env.convertUrl}/word/export`, { method: 'POST', body: form, signal: AbortSignal.timeout(600_000) }).catch(() => null);
    if (!response) throw new HTTPException(503, { message: 'The converter is not available right now.' });
    if (!response.ok) {
      const detail: any = await response.json().catch(() => null);
      throw new HTTPException(response.status >= 500 ? 502 : 422, { message: String(detail?.detail || 'The document could not be converted.').slice(0, 300) });
    }
    const charged = await bill(c, 'conversions', 1, randomUUID(), { format: parsed.data.format });
    return new Response(response.body, { status: 200, headers: passHeaders(response, creditHeaders(charged)) });
  });

  // Stateless server: no event stream to open and no session to end.
  app.get('/mcp', (c) => c.json({ error: { message: 'Use POST for MCP messages.' } }, 405));
  app.delete('/mcp', (c) => c.body(null, 204));

  return app;
}
