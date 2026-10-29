import type { PeerReviewResult, SourceCheck } from '../../../lib/aiEditor/assistApi';

/** The Review panel's checks: each runs on the whole document. */
export type CheckId = 'claims' | 'peer' | 'sources' | 'proofread' | 'tone';

/** Checks whose results arrive as AI comments, with the categories each can return. */
export const CHECK_CATEGORIES: Record<'claims' | 'proofread' | 'tone', [string, string][]> = {
  claims: [
    ['unsupported', 'Unsupported'],
    ['weakly_supported', 'Weakly supported'],
    ['overstated', 'Overstated'],
    ['unverifiable', 'Unverifiable'],
    ['contradicted', 'Contradicted'],
    ['misrepresented', 'Misrepresented'],
  ],
  proofread: [
    ['grammar', 'Grammar'],
    ['punctuation', 'Punctuation'],
    ['word_choice', 'Word choice'],
    ['formality', 'Formality'],
    ['passive_voice', 'Passive voice'],
    ['repetition', 'Repetition'],
    ['formatting', 'Formatting'],
  ],
  tone: [['tone', 'Tone']],
};

export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(Object.values(CHECK_CATEGORIES).flat());

export const TONES = ['Formal academic', 'Confident', 'Concise', 'Neutral and objective', 'Persuasive'];

/** What the panel remembers per document (this browser): when each check ran and its reports. */
export type ReviewMemory = {
  ranAt: Partial<Record<CheckId, number>>;
  /** What each check last ran on. */
  scope?: Partial<Record<CheckId, 'document' | 'selection'>>;
  tone?: string;
  peer?: PeerReviewResult;
  sources?: { results: SourceCheck[]; labels: Record<string, string> };
};

export type CheckRun = { running: boolean; error: string | null };

/** Opens the comments filtered to one check (and optionally one category). */
export type CommentFilter = { check: string; category?: string } | null;

const key = (documentId: string) => `videmak_review_${documentId}`;

export function readReviewMemory(documentId: string): ReviewMemory {
  try {
    const value = JSON.parse(window.localStorage.getItem(key(documentId)) || 'null');
    return value && typeof value === 'object' ? { ranAt: {}, ...value } : { ranAt: {} };
  } catch {
    return { ranAt: {} };
  }
}

export function writeReviewMemory(documentId: string, memory: ReviewMemory) {
  try {
    window.localStorage.setItem(key(documentId), JSON.stringify(memory));
  } catch {
    // Storage full or blocked: the results stay for this session.
  }
}
