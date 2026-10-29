/**
 * The LLM slot: one OpenAI-compatible client for every provider (Videmak Cloud, DeepSeek,
 * OpenAI, Anthropic, OpenRouter, Ollama). A slot without a usable key is still created;
 * its calls fail with a clear "not configured" error instead of crashing the server.
 */
import OpenAI from 'openai';
import { env } from '../env.js';
import type { ChatMessage, LlmSlot, LlmUsage } from './types.js';

export type LlmProvider = 'videmak' | 'deepseek' | 'openai' | 'anthropic' | 'openrouter' | 'ollama';

export const LLM_PROVIDERS: readonly LlmProvider[] = ['videmak', 'deepseek', 'openai', 'anthropic', 'openrouter', 'ollama'];

export const NOT_CONFIGURED_MESSAGE = 'AI is not configured: set VIDEMAK_API_KEY or LLM_API_KEY';
export const OUT_OF_CREDIT_MESSAGE = 'Insufficient AI credits: add credits to keep using the AI features.';

/** Why an AI call failed, with the HTTP status the API answers. */
export class LlmError extends Error {
  readonly status: 402 | 429 | 502 | 503 | 504;
  readonly code: 'not_configured' | 'quota' | 'busy' | 'upstream' | 'timeout';
  constructor(code: LlmError['code'], message: string) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = ({ not_configured: 503, quota: 402, busy: 429, upstream: 502, timeout: 504 } as const)[code];
  }
}

export type LlmSettings = Pick<
  typeof env,
  'llmProvider' | 'llmApiKey' | 'llmBaseUrl' | 'llmModel' | 'llmReviewModel' | 'videmakApiKey' | 'videmakApiUrl' | 'publicUrl'
>;

export type LlmConfig = {
  provider: string;
  baseURL: string;
  apiKey: string;
  models: { fast: string; review: string };
  /** Why calls cannot run (missing key, unknown provider); null when ready. */
  unavailable: string | null;
  /** OpenAI's newer models take max_completion_tokens and no custom temperature. */
  tokenParam: 'max_tokens' | 'max_completion_tokens';
  jsonMode: boolean;
  headers?: Record<string, string>;
};

const DEFAULTS: Record<LlmProvider, { baseURL: string; fast: string; review: string; needsKey: boolean }> = {
  // The gateway proxies the product default (DeepSeek) unless told otherwise.
  videmak: { baseURL: '', fast: 'deepseek-chat', review: 'deepseek-chat', needsKey: true },
  // Review stays on the fast chat model (with more output room); reasoning models truncated reviews.
  deepseek: { baseURL: 'https://api.deepseek.com', fast: 'deepseek-chat', review: 'deepseek-chat', needsKey: true },
  openai: { baseURL: 'https://api.openai.com/v1', fast: 'gpt-4.1-mini', review: 'gpt-4.1', needsKey: true },
  anthropic: { baseURL: 'https://api.anthropic.com/v1/', fast: 'claude-haiku-4-5', review: 'claude-sonnet-4-5', needsKey: true },
  openrouter: { baseURL: 'https://openrouter.ai/api/v1', fast: 'deepseek/deepseek-chat', review: 'deepseek/deepseek-chat', needsKey: true },
  ollama: { baseURL: 'http://localhost:11434/v1', fast: 'llama3.1', review: 'llama3.1', needsKey: false },
};

/** Which provider, endpoint, key and models the settings select. Pure, for tests. */
export function resolveLlmConfig(settings: LlmSettings = env): LlmConfig {
  const requested = settings.llmProvider.toLowerCase();
  const provider = requested || (settings.videmakApiKey ? 'videmak' : 'deepseek');
  if (!(LLM_PROVIDERS as readonly string[]).includes(provider)) {
    return {
      provider,
      baseURL: '',
      apiKey: '',
      models: { fast: '', review: '' },
      unavailable: `AI is not configured: unknown LLM_PROVIDER "${provider}" (use ${LLM_PROVIDERS.join(', ')})`,
      tokenParam: 'max_tokens',
      jsonMode: false,
    };
  }
  const name = provider as LlmProvider;
  const defaults = DEFAULTS[name];
  const apiKey = name === 'videmak' ? settings.videmakApiKey || settings.llmApiKey : name === 'ollama' ? settings.llmApiKey || 'ollama' : settings.llmApiKey;
  const baseURL = (settings.llmBaseUrl || (name === 'videmak' ? `${settings.videmakApiUrl}/v1` : defaults.baseURL)).replace(/\/+$/, '');
  const fast = settings.llmModel || defaults.fast;
  const review = settings.llmReviewModel || settings.llmModel || defaults.review;
  const headers = name === 'openrouter' ? { 'HTTP-Referer': settings.publicUrl, 'X-Title': 'Videmak' } : undefined;
  return {
    provider: name,
    baseURL,
    apiKey,
    models: { fast, review },
    unavailable: defaults.needsKey && !apiKey ? NOT_CONFIGURED_MESSAGE : null,
    tokenParam: name === 'openai' ? 'max_completion_tokens' : 'max_tokens',
    // Anthropic's compatibility layer ignores response_format; the prompts ask for JSON anyway.
    jsonMode: name !== 'anthropic',
    headers,
  };
}

/** ~4 characters per token, for providers that leave out the usage field. */
export function estimateTokens(text: string): number {
  return text ? Math.max(1, Math.ceil(text.length / 4)) : 0;
}

function estimateUsage(messages: ChatMessage[], output: string): LlmUsage {
  return { inputTokens: messages.reduce((sum, message) => sum + estimateTokens(message.content), 0), outputTokens: estimateTokens(output) };
}

const FAST_MAX_TOKENS = 1024;
const REVIEW_MIN_TOKENS = 4096;
const MAX_OUTPUT_TOKENS = 8192;

function outputLimit(task: 'fast' | 'review', requested?: number) {
  // Reviews get generous room: a cut-off JSON answer loses every comment in it.
  if (task === 'review') return Math.min(MAX_OUTPUT_TOKENS, Math.max(requested ?? 0, REVIEW_MIN_TOKENS));
  return Math.min(MAX_OUTPUT_TOKENS, Math.max(1, requested ?? FAST_MAX_TOKENS));
}

/** Models that only accept the default temperature (OpenAI reasoning families). */
const FIXED_TEMPERATURE = /^(o\d|gpt-5)/i;

function isAbort(error: unknown) {
  return error instanceof OpenAI.APIUserAbortError || (error instanceof Error && error.name === 'AbortError');
}

/** Provider errors -> LlmError with the status the API should answer. */
export function classifyLlmError(error: unknown, provider: string): unknown {
  if (error instanceof LlmError || isAbort(error)) return error;
  if (error instanceof OpenAI.APIConnectionTimeoutError) return new LlmError('timeout', 'The AI took too long to answer. Try again.');
  if (error instanceof OpenAI.APIConnectionError) return new LlmError('upstream', 'The AI service could not be reached. Try again.');
  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? 0;
    const text = `${error.message} ${JSON.stringify(error.error ?? '')}`;
    const billing = /insufficient|quota|balance|credit|billing|payment|spend cap/i.test(text);
    if (status === 402 || (status === 429 && billing) || (status === 400 && /credit balance/i.test(text))) {
      return new LlmError('quota', OUT_OF_CREDIT_MESSAGE);
    }
    if (status === 401 || status === 403) {
      return new LlmError('not_configured', `AI is not configured: ${provider} rejected the API key (check VIDEMAK_API_KEY or LLM_API_KEY)`);
    }
    if (status === 404) return new LlmError('not_configured', `AI is not configured: ${provider} does not know the model (check LLM_MODEL)`);
    if (status === 429) return new LlmError('busy', 'The AI is busy right now. Try again in a moment.');
    return new LlmError('upstream', 'The AI service failed. Try again.');
  }
  return error;
}

export type LlmSlotWithConfig = LlmSlot & { readonly config: LlmConfig };

export function createLlmSlot(options: { settings?: LlmSettings; fetch?: typeof fetch } = {}): LlmSlotWithConfig {
  const config = resolveLlmConfig(options.settings ?? env);
  let client: OpenAI | null = null;
  const getClient = () => {
    if (config.unavailable) throw new LlmError('not_configured', config.unavailable);
    client ??= new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: 120_000,
      maxRetries: 1,
      defaultHeaders: config.headers,
      ...(options.fetch ? { fetch: options.fetch as any } : {}),
    });
    return client;
  };

  const body = (input: { messages: ChatMessage[]; task?: 'fast' | 'review'; maxTokens?: number; temperature?: number }) => {
    const task = input.task ?? 'fast';
    const model = config.models[task];
    return {
      model,
      messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
      [config.tokenParam]: outputLimit(task, input.maxTokens),
      ...(input.temperature !== undefined && !FIXED_TEMPERATURE.test(model) ? { temperature: input.temperature } : {}),
    };
  };

  return {
    provider: config.provider,
    config,

    async complete(input) {
      try {
        const openai = getClient();
        const request: Record<string, unknown> = body(input);
        if (input.json && config.jsonMode) request.response_format = { type: 'json_object' };
        let response: OpenAI.Chat.Completions.ChatCompletion;
        try {
          response = await openai.chat.completions.create(request as any, { signal: input.signal });
        } catch (error) {
          // Some models reject JSON mode; the prompt still asks for JSON.
          if (!(request.response_format && error instanceof OpenAI.BadRequestError)) throw error;
          delete request.response_format;
          response = await openai.chat.completions.create(request as any, { signal: input.signal });
        }
        const text = response.choices?.[0]?.message?.content ?? '';
        const estimate = estimateUsage(input.messages, text);
        const usage: LlmUsage = {
          inputTokens: response.usage?.prompt_tokens ?? estimate.inputTokens,
          outputTokens: response.usage?.completion_tokens ?? estimate.outputTokens,
        };
        return { text, usage };
      } catch (error) {
        throw classifyLlmError(error, config.provider);
      }
    },

    async stream(input, onDelta) {
      let text = '';
      try {
        const openai = getClient();
        const request: Record<string, unknown> = { ...body(input), stream: true, stream_options: { include_usage: true } };
        let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
        try {
          stream = (await openai.chat.completions.create(request as any, { signal: input.signal })) as any;
        } catch (error) {
          // A server that does not know stream_options answers 400 before streaming anything.
          if (!(error instanceof OpenAI.BadRequestError)) throw error;
          delete request.stream_options;
          stream = (await openai.chat.completions.create(request as any, { signal: input.signal })) as any;
        }
        let reported: { prompt_tokens?: number; completion_tokens?: number } | null | undefined;
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            text += delta;
            onDelta(delta);
          }
          if (chunk.usage) reported = chunk.usage;
        }
        const estimate = estimateUsage(input.messages, text);
        return {
          text,
          usage: { inputTokens: reported?.prompt_tokens ?? estimate.inputTokens, outputTokens: reported?.completion_tokens ?? estimate.outputTokens },
        };
      } catch (error) {
        const classified = classifyLlmError(error, config.provider);
        if (classified instanceof Error && text) Object.assign(classified, { partialText: text });
        throw classified;
      }
    },
  };
}

/** The model a task runs on, for responses that report it (falls back to the provider name). */
export function llmModelName(slot: LlmSlot, task: 'fast' | 'review' = 'fast'): string {
  const config = (slot as Partial<LlmSlotWithConfig>).config;
  return config?.models?.[task] || slot.provider;
}

/** Why the slot cannot run, before any call is made; null when it can (or is not ours). */
export function llmUnavailable(slot: LlmSlot): string | null {
  return (slot as Partial<LlmSlotWithConfig>).config?.unavailable ?? null;
}
