import { settings, type EffectiveSettings } from './settings.js';
import { resolvePapersEndpoint } from '../slots/papers.js';

/**
 * Scholar's full text (CEDOA Files) and research tools, reached with this install's Scholar key
 * or through a Videmak Cloud key (same requests, charged in credits). Paper search itself goes
 * through the papers slot.
 */
export type ScholarAccess = { via: 'scholar' | 'videmak'; files: string; research: string; headers: Record<string, string> };

export function scholarAccess(s: EffectiveSettings = settings()): ScholarAccess | null {
  const provider = resolvePapersEndpoint(s).provider;
  if (provider === 'videmak' && s.videmakApiKey) {
    return { via: 'videmak', files: `${s.videmakApiUrl}/v1/files`, research: `${s.videmakApiUrl}/v1/research`, headers: { Authorization: `Bearer ${s.videmakApiKey}` } };
  }
  if (provider === 'scholar' && s.scholarApiKey) {
    return { via: 'scholar', files: `${s.scholarUrl}/v1/research-corpus`, research: `${s.scholarUrl}/api/v1/research`, headers: { Authorization: `Bearer ${s.scholarApiKey}` } };
  }
  return null;
}

export class ScholarError extends Error {
  constructor(message: string, readonly status = 503) { super(message); this.name = 'ScholarError'; }
}

/** Runs one research tool and returns its result (`structuredContent.result` when there is one). */
export async function researchTool<T = unknown>(name: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<T> {
  const access = scholarAccess();
  if (!access) throw new ScholarError('Research tools need a Scholar key or a Videmak Cloud key (Admin › Papers).');
  const response = await fetch(`${access.research}/tools/${name}`, {
    method: 'POST', headers: { ...access.headers, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(timeoutMs),
  });
  const json: any = await response.json().catch(() => null);
  if (response.status === 402) throw new ScholarError(json?.error?.message || 'Out of credits.', 402);
  if (!response.ok || !json || json.isError) {
    const text = json?.content?.find?.((part: any) => part?.type === 'text')?.text || json?.error?.message || `Research tools answered ${response.status}.`;
    throw new ScholarError(String(text).slice(0, 300), response.status === 429 ? 429 : 503);
  }
  return (json.structuredContent?.result ?? json.structuredContent ?? json) as T;
}

/**
 * A paper's PDF from Scholar's stored copies: the bytes when Scholar holds them, else the
 * external link it ranks best (fetched without our credentials), else null.
 */
export async function scholarPdf(workId: string): Promise<{ bytes: Buffer } | { url: string } | null> {
  const access = scholarAccess();
  const id = workId.replace(/^https?:\/\/openalex\.org\//i, '');
  if (!access || !/^W\d+$/i.test(id)) return null;
  const response = await fetch(`${access.files}/pdf/${id}`, { headers: access.headers, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
  if (response.status === 200 && (response.headers.get('content-type') || '').includes('pdf')) return { bytes: Buffer.from(await response.arrayBuffer()) };
  const location = response.headers.get('location');
  await response.body?.cancel().catch(() => undefined);
  if (response.status >= 300 && response.status < 400 && location && /^https:\/\//i.test(location)) return { url: location };
  return null;
}

/** For Admin › Papers: which Scholar services the key reaches, and the day's requests left. */
export async function checkScholar(s: EffectiveSettings = settings()) {
  const access = scholarAccess(s);
  const endpoint = resolvePapersEndpoint(s);
  const probe = async (url: string, headers: Record<string, string>) => {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      await response.body?.cancel().catch(() => undefined);
      return { ok: response.ok, status: response.status, left: response.headers.get('x-ratelimit-remaining') };
    } catch {
      return { ok: false, status: 0, left: null };
    }
  };
  const metadata = await probe(`${endpoint.base}/works?search=sleep&per_page=1`, endpoint.headers);
  // Without a key the allowance headers describe the shared anonymous pool, not this install.
  if (!access) return { via: endpoint.provider, metadata: metadata.ok, files: false, research: false, requests_left_today: null };
  const [files, research] = await Promise.all([probe(`${access.files}/list?limit=1`, access.headers), probe(`${access.research}/tools`, access.headers)]);
  return { via: access.via, metadata: metadata.ok, files: files.ok, research: research.ok, requests_left_today: metadata.left };
}
