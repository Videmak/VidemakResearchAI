'use client';

import { getAuthHeader } from '../../utils/auth/api';
import { notePlanLimit } from '../planLimit';

/**
 * The editor assistant: paper search for citing, AI Edit, autocomplete, review comments,
 * chat and version history.
 */

export class AssistError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
  /** The writer has run out of AI credits (show the upgrade card, not an error). */
  get outOfCredits() {
    return this.status === 402;
  }
}

async function failure(response: Response, fallback: string): Promise<AssistError> {
  let message = fallback;
  try {
    const body = await response.json();
    const detail = body?.detail ?? body?.error;
    if (typeof detail === 'string' && detail.trim()) message = detail;
  } catch {
    /* not JSON */
  }
  if (response.status === 402) notePlanLimit(message);
  return new AssistError(message, response.status);
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}, fallback = 'Something went wrong. Try again.'): Promise<T> {
  const { json, ...rest } = init;
  const response = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...getAuthHeader(), ...(rest.headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!response.ok) throw await failure(response, fallback);
  return response.json() as Promise<T>;
}

// ------------------------------------------------------------------ papers

export type Paper = {
  id: string;
  title: string;
  authors: { name: string; id?: string; institution?: string | null }[];
  extra_author_count?: number;
  year: number | null;
  publication_date?: string | null;
  doi?: string | null;
  cited_by_count?: number;
  is_open_access?: boolean;
  oa_url?: string | null;
  pdf_url?: string | null;
  abstract?: string | null;
  source_name?: string | null;
  type?: string;
  bibtex: string;
};

export type PaperFilters = {
  yearFrom?: number | null;
  yearTo?: number | null;
  minCited?: number | null;
  openAccess?: boolean;
  sort?: 'relevance' | 'cited' | 'newest';
  page?: number;
  perPage?: number;
};

export function searchPapers(query: string, filters: PaperFilters = {}, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query });
  if (filters.yearFrom) params.set('year_from', String(filters.yearFrom));
  if (filters.yearTo) params.set('year_to', String(filters.yearTo));
  if (filters.minCited) params.set('min_cited', String(filters.minCited));
  if (filters.openAccess) params.set('open_access', 'true');
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.perPage) params.set('per_page', String(filters.perPage));
  return request<{ results: Paper[]; total: number; page: number }>(`/api/ai-editor/assist/papers?${params}`, { signal }, 'Paper search is busy. Try again.');
}

export function lookupPaper(doi: string, signal?: AbortSignal) {
  return request<Paper>(`/api/ai-editor/assist/papers/lookup?doi=${encodeURIComponent(doi)}`, { signal }, 'No details for this paper.');
}

export function papersForText(text: string, documentTitle?: string) {
  return request<{ queries: string[]; results: Paper[] }>('/api/ai-editor/assist/papers/for-text', {
    method: 'POST',
    json: { text, document_title: documentTitle || undefined, limit: 10 },
  }, 'Could not find citations for this paragraph.');
}

export function paperAuthorsLabel(paper: Pick<Paper, 'authors' | 'extra_author_count'>, max = 3) {
  const names = (paper.authors || []).map((author) => author.name).filter(Boolean);
  if (!names.length) return 'Unknown authors';
  const extra = names.length - max + (paper.extra_author_count || 0);
  return names.slice(0, max).join(', ') + (extra > 0 ? ` +${extra}` : '');
}

// ------------------------------------------------------------------ writing help

/** A source the AI may cite as [S<n>]. */
export type AssistSource = {
  n: number;
  marker: string;
  title: string;
  authors: string[];
  year: number | string | null;
  doi?: string | null;
  url?: string | null;
  venue?: string | null;
  abstract?: string;
  bibtex: string;
  source_type: string;
  library_document_id?: string | null;
  cited_by_count?: number | null;
  is_open_access?: boolean | null;
};

export type SourceOptions = { useWeb: boolean; useLibrary: boolean; libraryDocumentIds?: string[] };

export function aiEdit(payload: {
  text: string;
  instruction: string;
  documentTitle?: string;
  before?: string;
  after?: string;
  sources: SourceOptions;
  language?: string;
}, signal?: AbortSignal) {
  return request<{ text: string; sources: AssistSource[] }>('/api/ai-editor/assist/edit', {
    method: 'POST',
    signal,
    json: {
      text: payload.text,
      instruction: payload.instruction,
      document_title: payload.documentTitle || undefined,
      before: payload.before?.slice(-4000),
      after: payload.after?.slice(0, 4000),
      use_web: payload.sources.useWeb,
      use_library: payload.sources.useLibrary,
      library_document_ids: payload.sources.libraryDocumentIds || [],
      language: payload.language,
    },
  }, 'AI Edit could not finish. Try again.');
}

export function autocomplete(payload: {
  before: string;
  after?: string;
  documentTitle?: string;
  sectionTitle?: string;
  cite: boolean;
  refine?: string;
  language?: string;
  /** paragraph: two or three sentences ("AI suggest"); conclude: close the section, name the next. */
  length?: 'sentence' | 'paragraph' | 'conclude';
  settings?: AutocompleteSettings;
  outline?: string[];
  nextSectionExists?: boolean;
}, signal?: AbortSignal) {
  return request<{ text: string; sources: AssistSource[]; ms: number; heading?: string | null; title?: string | null }>('/api/ai-editor/assist/complete', {
    method: 'POST',
    signal,
    json: {
      before: payload.before.slice(-6000),
      after: payload.after?.slice(0, 1000),
      document_title: payload.documentTitle || undefined,
      section_title: payload.sectionTitle || undefined,
      cite: payload.cite,
      refine: payload.refine,
      language: payload.language,
      length: payload.length,
      use_web: payload.settings?.web ?? true,
      use_library: payload.settings?.library ?? false,
      include_preprints: payload.settings?.preprints ?? true,
      library_document_ids: payload.settings?.libraryDocuments?.map((item) => item.id),
      library_folder_ids: payload.settings?.libraryFolders?.map((item) => item.id),
      year_from: payload.settings?.yearFrom ?? undefined,
      min_cited: payload.settings?.minCited ?? undefined,
      outline: payload.outline,
      next_section_exists: payload.nextSectionExists,
    },
  });
}

/** Where autocomplete looks for sources and which papers it may cite. */
export type AutocompleteSettings = {
  web: boolean;
  library: boolean;
  yearFrom: number | null;
  minCited: number | null;
  preprints: boolean;
  /** "Limit Library to": chosen sources and folders (empty = the whole Library). */
  libraryDocuments: { id: string; title: string }[];
  libraryFolders: { id: string; name: string }[];
};
export const DEFAULT_AUTOCOMPLETE_SETTINGS: AutocompleteSettings = {
  web: true,
  library: true,
  yearFrom: null,
  minCited: null,
  preprints: true,
  libraryDocuments: [],
  libraryFolders: [],
};

export type ReviewComment = {
  id: string;
  blockId: string;
  quote: string;
  comment: string;
  severity: 'minor' | 'major';
  category: string;
  suggestion?: string | null;
};

export type ReviewMode = 'general' | 'claims' | 'proofread' | 'tone';

export function reviewBlocks(payload: {
  blocks: { id: string; text: string; heading?: boolean }[];
  documentTitle?: string;
  scope: 'document' | 'block';
  focus?: string;
  language?: string;
  mode?: ReviewMode;
  tone?: string;
}) {
  return request<{ comments: ReviewComment[] }>('/api/ai-editor/assist/review', {
    method: 'POST',
    json: {
      blocks: payload.blocks,
      document_title: payload.documentTitle || undefined,
      scope: payload.scope,
      focus: payload.focus || undefined,
      language: payload.language,
      mode: payload.mode || undefined,
      tone: payload.tone || undefined,
    },
  }, 'The review could not finish. Try again.');
}

export type PeerReviewResult = { report: string; recommendation: string | null; reviewedWords: number; truncated: boolean };

/** A referee report on the whole document (the Review panel's Peer review). */
export function peerReview(payload: { text: string; documentTitle?: string; field?: string }) {
  return request<PeerReviewResult>('/api/ai-editor/assist/peer-review', {
    method: 'POST',
    json: { text: payload.text, document_title: payload.documentTitle || undefined, field: payload.field || undefined },
  }, 'The peer review could not finish. Try again.');
}

export type SourceFlag = { kind: 'not_found' | 'retracted' | 'preprint' | 'mismatch' | 'old' | string; label: string };
export type SourceCheck = {
  key: string;
  status: 'ok' | 'warning' | 'problem' | 'error';
  flags: SourceFlag[];
  paper: { title: string; year: number | null; venue: string | null; doi: string | null; cited_by_count: number | null } | null;
};

/** Each cited work checked for retractions, preprints, missing records and wrong DOIs. */
export function sourceQuality(sources: { key: string; doi?: string | null; title?: string | null; year?: string | number | null }[]) {
  return request<{ results: SourceCheck[] }>('/api/ai-editor/assist/source-quality', {
    method: 'POST',
    json: { sources },
  }, 'The source check could not finish. Try again.');
}

export function aiCommentReply(payload: {
  quote: string;
  blockText: string;
  documentTitle?: string;
  thread: { author: string; text: string }[];
  question: string;
}) {
  return request<{ text: string }>('/api/ai-editor/assist/comment-reply', {
    method: 'POST',
    json: {
      quote: payload.quote,
      block_text: payload.blockText,
      document_title: payload.documentTitle || undefined,
      thread: payload.thread,
      question: payload.question,
    },
  });
}

// ------------------------------------------------------------------ chat

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: AssistSource[];
  selection?: string;
  createdAt?: string;
};

export type ChatSummary = { id: string; title: string; updatedAt: string; messageCount: number };

export function listChats(documentId: string) {
  return request<{ chats: ChatSummary[] }>(`/api/ai-editor/assist/chats?document_id=${encodeURIComponent(documentId)}`);
}

export function getChat(threadId: string) {
  return request<ChatSummary & { messages: ChatMessage[] }>(`/api/ai-editor/assist/chats/${encodeURIComponent(threadId)}`);
}

export function deleteChat(threadId: string) {
  return request<{ success: boolean }>(`/api/ai-editor/assist/chats/${encodeURIComponent(threadId)}`, { method: 'DELETE' });
}

export type ChatStreamHandlers = {
  onSources?: (threadId: string, sources: AssistSource[]) => void;
  onDelta: (text: string) => void;
  onDone: (threadId: string, message: ChatMessage) => void;
};

/** Sends a chat message and streams the answer (Server-Sent Events). */
export async function streamChat(payload: {
  documentId: string;
  threadId?: string | null;
  message: string;
  documentTitle?: string;
  documentText?: string;
  selection?: string;
  useDocument: boolean;
  sources: SourceOptions;
}, handlers: ChatStreamHandlers, signal?: AbortSignal) {
  const response = await fetch('/api/ai-editor/assist/chat', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...getAuthHeader() },
    body: JSON.stringify({
      document_id: payload.documentId,
      thread_id: payload.threadId || undefined,
      message: payload.message,
      document_title: payload.documentTitle || undefined,
      document_text: payload.documentText,
      selection: payload.selection || undefined,
      use_document: payload.useDocument,
      use_web: payload.sources.useWeb,
      use_library: payload.sources.useLibrary,
      library_document_ids: payload.sources.libraryDocumentIds || [],
    }),
  });
  if (!response.ok || !response.body) throw await failure(response, 'The chat is unavailable. Try again.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      const event = /^event: (.+)$/m.exec(chunk)?.[1]?.trim();
      const dataLine = chunk.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n');
      if (!event || !dataLine) continue;
      let data: any;
      try {
        data = JSON.parse(dataLine);
      } catch {
        continue;
      }
      if (event === 'sources') handlers.onSources?.(data.threadId, data.sources || []);
      else if (event === 'delta') handlers.onDelta(String(data.text || ''));
      else if (event === 'done') {
        finished = true;
        handlers.onDone(data.threadId, data.message);
      } else if (event === 'error') throw new AssistError(String(data.detail || 'The chat stopped.'), Number(data.status) || 500);
    }
  }
  if (!finished) throw new AssistError('The answer was cut off. Try again.', 502);
}

// ------------------------------------------------------------------ version history

export type DocumentVersion = {
  id: string;
  createdAt: string;
  authorName: string;
  reason: 'auto' | 'import' | 'manual' | 'before-restore' | 'restore' | 'ai';
  label?: string | null;
  title: string;
  wordCount: number;
  blockCount: number;
};

export type DocumentVersionContent = DocumentVersion & { blocks: any[]; wordSettings?: Record<string, any> | null };

const versionsPath = (documentId: string) => `/api/ai-editor/documents/${encodeURIComponent(documentId)}/versions`;

export function listVersions(documentId: string) {
  return request<{ versions: DocumentVersion[] }>(versionsPath(documentId), {}, 'Version history is unavailable.');
}

export function getVersion(documentId: string, versionId: string) {
  return request<DocumentVersionContent>(`${versionsPath(documentId)}/${encodeURIComponent(versionId)}`, {}, 'This version could not be opened.');
}

export function saveNamedVersion(documentId: string, label?: string) {
  return request<DocumentVersion>(versionsPath(documentId), { method: 'POST', json: { label: label || undefined } }, 'The version could not be saved.');
}

/** Accepted AI text, kept in the version history under Videmak AI (the server groups bursts). */
export function saveAIVersion(documentId: string) {
  return request<DocumentVersion>(versionsPath(documentId), { method: 'POST', json: { reason: 'ai' } }, 'The version could not be saved.');
}

export function renameVersion(documentId: string, versionId: string, label: string | null) {
  return request<DocumentVersion>(`${versionsPath(documentId)}/${encodeURIComponent(versionId)}`, { method: 'PATCH', json: { label } });
}

export function restoreVersion(documentId: string, versionId: string) {
  return request<DocumentVersionContent>(`${versionsPath(documentId)}/${encodeURIComponent(versionId)}/restore`, { method: 'POST' }, 'This version could not be restored.');
}
