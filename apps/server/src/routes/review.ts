/**
 * Grammar and writing-flow suggestions for one paragraph (POST /review; the browser calls
 * /api/ai-editor/review), answered synchronously (the browser accepts the JSON answer directly).
 */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser, type AppVariables } from '../auth.js';
import type { Slots } from '../slots/types.js';
import { llmModelName } from '../slots/llm.js';
import { BLOCK_REVIEW_SYSTEM_PROMPT, blockReviewPrompt } from '../lib/prompts.js';
import { completeMetered, countWords, currentUser, extractJsonObject, parseBody, withHttpErrors } from '../lib/assist-llm.js';

const optionalText = z.string().nullish();

const ReviewRequest = z.object({
  text: z.string().min(1).max(12000),
  block_id: optionalText,
  document_title: optionalText,
  document_summary: optionalText,
  previous_text: optionalText,
  next_text: optionalText,
  language: optionalText,
  focus_text: optionalText,
  preferred_action: optionalText,
  citation_placeholders: z.array(z.string()).default([]),
  max_issues: z.number().int().min(1).max(10).default(5),
  request_id: z.string().max(100).nullish(),
});

export type ReviewIssue = {
  id: string;
  category: string;
  severity: string;
  title: string;
  explanation: string;
  original_text: string;
  suggested_text: string;
  block_id: string | null;
  start_offset: number;
  end_offset: number;
};

/** The first place `needle` occurs in `source` that no earlier issue uses (exact, then any case). */
export function findUnusedSpan(source: string, needle: string, used: [number, number][]): [number, number] | null {
  if (!needle) return null;
  const free = (start: number, end: number) => used.every(([usedStart, usedEnd]) => end <= usedStart || start >= usedEnd);
  for (const [haystack, target] of [
    [source, needle],
    [source.toLowerCase(), needle.toLowerCase()],
  ]) {
    let from = 0;
    for (;;) {
      const found = haystack.indexOf(target, from);
      if (found === -1) break;
      const end = found + needle.length;
      if (free(found, end)) return [found, end];
      from = found + 1;
    }
  }
  return null;
}

/** Model issues -> issues anchored to exact offsets; drops any that touch citations or cannot be found. */
export function normalizeIssues(text: string, blockId: string | null, placeholders: string[], rawIssues: Record<string, unknown>[]): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const used: [number, number][] = [];
  for (const item of rawIssues) {
    const original = String(item.original_text ?? '').trim();
    const suggested = String(item.suggested_text ?? '').trim();
    if (!original || !suggested || original === suggested) continue;
    if (placeholders.some((placeholder) => placeholder && (original.includes(placeholder) || suggested.includes(placeholder)))) continue;
    const span = findUnusedSpan(text, original, used);
    if (!span) continue;
    used.push(span);
    issues.push({
      id: randomUUID(),
      category: String(item.category || 'clarity').trim().toLowerCase() || 'clarity',
      severity: String(item.severity || 'low').trim().toLowerCase() || 'low',
      title: String(item.title ?? '').trim() || 'Writing suggestion',
      explanation: String(item.explanation ?? '').trim() || 'Suggested improvement for readability.',
      original_text: text.slice(span[0], span[1]),
      suggested_text: suggested,
      block_id: blockId,
      start_offset: span[0],
      end_offset: span[1],
    });
  }
  return issues;
}

/** Mount at /api/ai-editor (the route is POST /review). */
export function reviewRoutes(slots: Slots) {
  const app = new Hono<{ Variables: AppVariables }>();

  // requireUser per route: a use('*') here would also guard every other /api/ai-editor route.
  app.post('/review', requireUser, async (c) => {
    const user = currentUser(c);
    const body = await parseBody(c, ReviewRequest);
    return withHttpErrors(async () => {
      const raw = await completeMetered(
        slots.llm,
        user,
        {
          messages: [
            { role: 'system', content: BLOCK_REVIEW_SYSTEM_PROMPT },
            {
              role: 'user',
              content: blockReviewPrompt({
                text: body.text,
                documentTitle: body.document_title,
                documentSummary: body.document_summary,
                previousText: body.previous_text,
                nextText: body.next_text,
                language: body.language,
                focusText: body.focus_text,
                preferredAction: body.preferred_action,
                citationPlaceholders: body.citation_placeholders,
                maxIssues: body.max_issues,
              }),
            },
          ],
          task: 'review',
          temperature: 0.1,
          maxTokens: 2200,
          json: true,
        },
        { feature: 'ai-editor-review', reviewWords: countWords(body.text) },
      );
      const parsed = extractJsonObject(raw);
      const rawIssues = Array.isArray(parsed.issues) ? (parsed.issues as unknown[]) : [];
      const issues = normalizeIssues(
        body.text,
        body.block_id ?? null,
        body.citation_placeholders,
        rawIssues.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)),
      );
      return c.json({
        success: true,
        issues: issues.slice(0, body.max_issues),
        model: llmModelName(slots.llm, 'review'),
        provider: slots.llm.provider,
        raw_issue_count: rawIssues.length,
        error: null,
      });
    });
  });

  return app;
}
