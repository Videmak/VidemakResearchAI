/**
 * Videmak Cloud prices, in credits. One credit is one paper or file request: the same credit
 * CitedEvidence Scholar sells, at the same pack prices, so neither undercuts the other.
 *
 * Services Scholar answers (papers, files, research tools, reference checks) come out of the
 * daily free credits first. AI, reviews and file conversions are always paid: AI is priced at
 * the provider's list price + 30% even when credits are bought in the largest pack.
 */

/** Credits per US dollar used to price AI: the largest pack's rate, so no pack sells AI below price + 30%. */
export const AI_CREDITS_PER_USD = 200;

/** DeepSeek list prices (USD per 1M tokens) + 30%. */
const AI_USD = { input: 0.39, cached: 0.0078, output: 1.56 };
const perMillion = (usd: number) => Math.round(usd * AI_CREDITS_PER_USD * 100) / 100;

export const SERVICES = {
  papers_requests: { label: 'Paper search and lookups', unit: 'request', perUnit: 1, credits: 1, free: true },
  files_requests: { label: 'Full text and PDFs', unit: 'request', perUnit: 1, credits: 1, free: true },
  research_calls: { label: 'Research tools (MCP)', unit: 'tool call', perUnit: 1, credits: 1, free: true },
  reference_checks: { label: 'Reference checks', unit: 'reference', perUnit: 1, credits: 1, free: true },
  llm_input_tokens: { label: 'AI input', unit: '1M tokens', perUnit: 1_000_000, credits: perMillion(AI_USD.input), free: false },
  llm_cached_tokens: { label: 'AI cached input', unit: '1M tokens', perUnit: 1_000_000, credits: perMillion(AI_USD.cached), free: false },
  llm_output_tokens: { label: 'AI output', unit: '1M tokens', perUnit: 1_000_000, credits: perMillion(AI_USD.output), free: false },
  review_words: { label: 'AI review', unit: '1,000 words', perUnit: 1_000, credits: 10, free: false },
  conversions: { label: 'Word, LaTeX and PDF files', unit: 'file', perUnit: 1, credits: 1, free: false },
} as const;

export type ServiceName = keyof typeof SERVICES;

export const isService = (value: string): value is ServiceName => Object.hasOwn(SERVICES, value);

/** What a call costs, in thousandths of a credit (at least 1 for anything used). */
export function costMilli(service: ServiceName, quantity: number): number {
  if (!quantity || quantity <= 0) return 0;
  const price = SERVICES[service];
  return Math.max(1, Math.ceil((quantity / price.perUnit) * price.credits * 1000));
}

/** Credit packs, the same as Scholar's. Bigger packs cost less per credit. */
export const CREDIT_PACKS = [
  { id: 'credits_2000', credits: 2_000, cents: 2_990 },
  { id: 'credits_10000', credits: 10_000, cents: 11_900 },
  { id: 'credits_100000', credits: 100_000, cents: 79_000 },
  { id: 'credits_1000000', credits: 1_000_000, cents: 499_000 },
] as const;

export type CreditPack = (typeof CREDIT_PACKS)[number];

export const packById = (id: string): CreditPack | undefined => CREDIT_PACKS.find((pack) => pack.id === id);

/** Shown in docs, the developer page and the account page. */
export function publicPrices() {
  return {
    services: Object.entries(SERVICES).map(([id, service]) => ({ id, ...service })),
    packs: CREDIT_PACKS.map((pack) => ({ ...pack, usd: pack.cents / 100, usd_per_1000: Math.round((pack.cents / pack.credits) * 1000) / 100 })),
  };
}
