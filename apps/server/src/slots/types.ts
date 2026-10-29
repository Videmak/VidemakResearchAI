/**
 * Service slots: each capability the editor needs from the outside world. With a
 * Videmak key every slot uses Videmak Cloud; any slot can be pointed at another provider.
 */
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type LlmUsage = { inputTokens: number; outputTokens: number };

export interface LlmSlot {
  readonly provider: string;
  /** One complete answer. `task` picks the model: 'fast' (default) or 'review'. */
  complete(input: { messages: ChatMessage[]; task?: 'fast' | 'review'; maxTokens?: number; temperature?: number; json?: boolean; signal?: AbortSignal }): Promise<{ text: string; usage: LlmUsage }>;
  /** Streams the answer as text deltas; resolves with usage at the end. */
  stream(input: { messages: ChatMessage[]; task?: 'fast' | 'review'; maxTokens?: number; temperature?: number; signal?: AbortSignal }, onDelta: (text: string) => void): Promise<{ text: string; usage: LlmUsage }>;
}

export type Paper = {
  id: string;
  title: string;
  authors: { name: string }[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  abstract: string | null;
  cited_by_count: number | null;
  is_oa: boolean;
  oa_url: string | null;
  pdf_url: string | null;
  type: string | null;
};

export interface PapersSlot {
  readonly provider: string;
  search(input: { query: string; limit?: number; fromYear?: number; toYear?: number; openAccess?: boolean; minCitations?: number }): Promise<Paper[]>;
  lookupDoi(doi: string): Promise<Paper | null>;
}

export interface Slots {
  llm: LlmSlot;
  papers: PapersSlot;
}
