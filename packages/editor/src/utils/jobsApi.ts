import { getApiBase, getAuthHeader } from './auth/api';
import { notePlanLimit } from '../lib/planLimit';

/**
 * Videmak's server answers editor requests directly, so the "durable job" calls the
 * editor inherited are plain requests here. A 402 hands the person to the host's upgrade flow.
 */
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'dead_letter';
export interface JobDetail {
  id: string;
  status: JobStatus;
  kind?: string;
  result_json?: Record<string, unknown> | null;
  error?: string | null;
  [key: string]: any;
}
export interface DurableJsonRequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  requestId?: string;
  onQueued?: (body: any) => void;
  onEvent?: (event: any) => void;
  onProgress?: (...args: any[]) => void;
  onConnectionState?: (state: any) => void;
  [key: string]: any;
}

function absolute(url: string) {
  return /^https?:\/\//.test(url) ? url : `${getApiBase()}${url}`;
}

async function failure(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null);
  const detail = typeof body?.detail === 'string' ? body.detail : typeof body?.error === 'string' ? body.error : '';
  if (response.status === 402) notePlanLimit(detail, true);
  const error = new Error(detail || `Request failed (${response.status})`) as Error & { status?: number };
  error.status = response.status;
  return error;
}

function headers(extra: Record<string, string> = {}, json = true): Record<string, string> {
  return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...getAuthHeader(), ...extra };
}

export async function postDurableJson<T>(url: string, body: unknown, opts: DurableJsonRequestOptions = {}): Promise<T> {
  const response = await fetch(absolute(url), { method: 'POST', headers: headers(opts.headers), body: JSON.stringify(body), signal: opts.signal });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

export async function postDurableForm<T>(url: string, body: FormData, opts: DurableJsonRequestOptions = {}): Promise<T> {
  const response = await fetch(absolute(url), { method: 'POST', headers: headers(opts.headers, false), body, signal: opts.signal });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

export async function postDurableArtifactForm(url: string, body: FormData, opts: DurableJsonRequestOptions = {}): Promise<Blob> {
  const response = await fetch(absolute(url), { method: 'POST', headers: headers(opts.headers, false), body, signal: opts.signal });
  if (!response.ok) throw await failure(response);
  return response.blob();
}

export async function getJob(jobId: string): Promise<JobDetail> {
  const response = await fetch(absolute(`/api/jobs/${encodeURIComponent(jobId)}`), { headers: headers() });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as JobDetail;
}

/** Polls a job until it finishes; Videmak rarely queues, so this mostly returns at once. */
export async function waitForJob(jobId: string, opts: { signal?: AbortSignal; [key: string]: unknown } = {}): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const job = await getJob(jobId);
    if (job.status === 'completed') return job.result_json ?? null;
    if (['failed', 'cancelled', 'dead_letter'].includes(job.status)) throw new Error(String(job.error || 'The job did not finish.'));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('The job is taking too long.');
}

export async function retryJob(jobId: string): Promise<string> {
  const response = await fetch(absolute(`/api/jobs/${encodeURIComponent(jobId)}/retry`), { method: 'POST', headers: headers() });
  if (!response.ok) throw await failure(response);
  const body = await response.json();
  return String(body?.job_id || jobId);
}
