/**
 * Metered AI calls for the editor routes: every call records its usage, and slot errors
 * become HTTP answers (503 not configured, 402 out of credit, 429 busy, 502 failed).
 */
import { randomUUID } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppVariables, AuthUser } from '../auth.js';
import { recordUsage, type UsageEvent } from '../usage.js';
import { LlmError, llmModelName } from '../slots/llm.js';
import { PapersError } from '../slots/papers.js';
import type { ChatMessage, LlmSlot, LlmUsage } from '../slots/types.js';

/** The signed-in writer (the routes sit behind requireUser). */
export function currentUser(c: Context<{ Variables: AppVariables }>): AuthUser {
  const user = c.get('user');
  if (!user) throw new HTTPException(401, { message: 'Sign in to continue.' });
  return user;
}

function validationMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  const field = issue?.path.join('.') || 'request';
  return `Invalid ${field}: ${issue?.message || 'not accepted'}`;
}

/** The JSON body checked against `schema`; 422 {detail} when it does not fit. */
export async function parseBody<S extends z.ZodTypeAny>(c: Context<any>, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HTTPException(422, { message: 'The request body must be JSON.' });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HTTPException(422, { message: validationMessage(parsed.error) });
  return parsed.data;
}

/** Query parameters checked against `schema`; 422 {detail} when they do not fit. */
export function parseQuery<S extends z.ZodTypeAny>(c: Context<any>, schema: S): z.output<S> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw new HTTPException(422, { message: validationMessage(parsed.error) });
  return parsed.data;
}

async function record(user: AuthUser, events: Omit<UsageEvent, 'accountId' | 'requestId'>[]) {
  const requestId = randomUUID();
  for (const event of events) {
    try {
      await recordUsage({ ...event, accountId: user.account_id, requestId });
    } catch (error) {
      console.error(`usage: could not record ${event.service}`, error);
    }
  }
}

export function meterTokens(user: AuthUser, usage: LlmUsage, metadata: Record<string, unknown>) {
  return record(user, [
    { service: 'llm_input_tokens', quantity: usage.inputTokens, metadata },
    { service: 'llm_output_tokens', quantity: usage.outputTokens, metadata },
  ]);
}

export function meterPapers(user: AuthUser, metadata: Record<string, unknown>, requests = 1) {
  return record(user, [{ service: 'papers_requests', quantity: requests, metadata }]);
}

export function meterReferenceChecks(user: AuthUser, checks: number, metadata: Record<string, unknown>) {
  return record(user, [{ service: 'reference_checks', quantity: checks, metadata }]);
}

export function meterReviewWords(user: AuthUser, words: number, metadata: Record<string, unknown>) {
  return record(user, [{ service: 'review_words', quantity: words, metadata }]);
}

export const countWords = (text: string) => (text.match(/\S+/g) || []).length;

export type LlmCall = {
  messages: ChatMessage[];
  task?: 'fast' | 'review';
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  signal?: AbortSignal;
};

/**
 * One AI answer, metered. Reviews are billed by the words reviewed (`reviewWords`), every
 * other call by tokens.
 */
export async function completeMetered(llm: LlmSlot, user: AuthUser, call: LlmCall, metering: { feature: string; reviewWords?: number }): Promise<string> {
  const { text, usage } = await llm.complete(call);
  const metadata = { feature: metering.feature, provider: llm.provider, model: llmModelName(llm, call.task) };
  if (metering.reviewWords !== undefined) {
    await meterReviewWords(user, metering.reviewWords, { ...metadata, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens });
  } else {
    await meterTokens(user, usage, metadata);
  }
  return text;
}

/** Errors no fallback can fix: the writer must see them (setup or credit). */
export const isBlockingLlmError = (error: unknown) => error instanceof LlmError && (error.code === 'not_configured' || error.code === 'quota');

/** Slot errors -> HTTPException with {detail}; anything else is left for the app's handler. */
export function toHttpError(error: unknown): unknown {
  if (error instanceof HTTPException) return error;
  if (error instanceof LlmError) return new HTTPException(error.status, { message: error.message });
  if (error instanceof PapersError) return new HTTPException(error.status, { message: error.message });
  return error;
}

export async function withHttpErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toHttpError(error);
  }
}

// ------------------------------------------------------------------ model output

/** A JSON value from a model answer (fenced, or with prose around it); null when none. */
export function parseJsonPayload(raw: string | null | undefined): unknown {
  let clean = (raw || '').trim();
  if (clean.startsWith('```')) clean = clean.replace(/^```[a-zA-Z]*\n?|```$/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    const match = /(\[[\s\S]*\]|\{[\s\S]*\})/.exec(clean);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }
}

/** A JSON object from a model answer; {} when there is none. */
export function extractJsonObject(raw: string | null | undefined): Record<string, unknown> {
  let clean = (raw || '').trim();
  if (!clean) return {};
  if (clean.startsWith('```')) clean = clean.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(clean);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    const match = /\{[\s\S]*\}/.exec(clean);
    if (!match) return {};
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
}

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
