import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { env } from '../env.js';
import { settings, settingsVersion, type EffectiveSettings } from './settings.js';

/**
 * Where uploaded files live: this server's disk (FILES_DIR) or any S3-compatible bucket
 * (Wasabi, Amazon S3, Cloudflare R2, Backblaze B2, MinIO…), chosen in Admin › Storage.
 * Files are addressed by a key such as `library/<user>/<id>.pdf`. New files go to the store
 * in use; a file not found there is still read from this server's disk, so switching to a
 * bucket never hides files saved before (Admin › Storage can copy them over).
 */

export type StoredFile = { body: ReadableStream<Uint8Array>; size: number | null; contentType: string | null };

interface Store {
  readonly provider: 'local' | 'wasabi' | 's3';
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  open(key: string): Promise<StoredFile | null>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** Keys are relative paths of plain characters; no `..`, no leading slash. */
export function checkKey(key: string): string {
  if (!KEY.test(key) || key.split('/').some((part) => part === '..' || part === '.') || key.length > 500) {
    throw new Error(`Invalid file key: ${key.slice(0, 80)}`);
  }
  return key;
}

/** A stored reference as a key: rows saved before keys held the absolute path under FILES_DIR. */
export function keyFromRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const root = `${env.filesDir.replace(/\/+$/, '')}/`;
  const key = ref.startsWith('/') ? (ref.startsWith(root) ? ref.slice(root.length) : null) : ref;
  if (!key) return null;
  try { return checkKey(key); } catch { return null; }
}

export class LocalStore implements Store {
  readonly provider = 'local' as const;
  constructor(private readonly root: string) {}
  private file(key: string) { return path.join(this.root, checkKey(key)); }
  async put(key: string, bytes: Uint8Array, _contentType?: string) {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  async open(key: string): Promise<StoredFile | null> {
    const file = this.file(key);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return null;
    return { body: Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>, size: info.size, contentType: null };
  }
  async exists(key: string) { return Boolean((await stat(this.file(key)).catch(() => null))?.isFile()); }
  async remove(key: string) { await unlink(this.file(key)).catch(() => undefined); }
}

/** The bucket address and signing details for Wasabi or another S3-compatible service. */
export function bucketConfig(s: EffectiveSettings) {
  const provider = s.storageProvider === 'wasabi' ? 'wasabi' : 's3';
  const region = s.s3Region || 'us-east-1';
  const endpoint = (provider === 'wasabi' ? `https://s3.${region}.wasabisys.com` : s.s3Endpoint || `https://s3.${region}.amazonaws.com`).replace(/\/+$/, '');
  const prefix = s.s3Prefix.replace(/^\/+|\/+$/g, '');
  return {
    provider, region, endpoint, bucket: s.s3Bucket, prefix: prefix ? `${prefix}/` : '',
    pathStyle: provider === 's3' && s.s3UrlStyle === 'path',
    accessKeyId: s.s3AccessKeyId, secretAccessKey: s.s3SecretAccessKey,
  } as const;
}

/** S3's XML error as one short line ("NoSuchBucket: The specified bucket does not exist"). */
async function s3Error(response: Response, action: string) {
  const text = await response.text().catch(() => '');
  const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1];
  const message = text.match(/<Message>([^<]+)<\/Message>/)?.[1];
  return new Error(`${action} failed (${response.status}${code ? ` ${code}` : ''})${message ? `: ${message}` : ''}`);
}

export class BucketStore implements Store {
  readonly provider: 'wasabi' | 's3';
  private readonly client: AwsClient;
  private readonly config: ReturnType<typeof bucketConfig>;

  constructor(config: ReturnType<typeof bucketConfig>) {
    if (!config.bucket || !config.accessKeyId || !config.secretAccessKey) throw new Error('Storage needs a bucket, an access key and a secret key.');
    this.config = config;
    this.provider = config.provider;
    this.client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: 's3', region: config.region, retries: 2 });
  }

  url(key: string) {
    const objectPath = `${this.config.prefix}${checkKey(key)}`.split('/').map(encodeURIComponent).join('/');
    const endpoint = new URL(this.config.endpoint);
    if (this.config.pathStyle) return `${endpoint.origin}/${encodeURIComponent(this.config.bucket)}/${objectPath}`;
    return `${endpoint.protocol}//${this.config.bucket}.${endpoint.host}/${objectPath}`;
  }

  /** Signed request; the time limit covers waiting for the response, not reading a long body. */
  private async request(key: string, init: RequestInit, waitMs = 30_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    try {
      return await this.client.fetch(this.url(key), { ...init, signal: controller.signal });
    } catch (error) {
      throw new Error(controller.signal.aborted ? 'The storage service did not answer in time.' : `Could not reach the storage service: ${(error as Error).message}`);
    } finally { clearTimeout(timer); }
  }

  async put(key: string, bytes: Uint8Array, contentType: string) {
    const response = await this.request(key, { method: 'PUT', body: bytes, headers: { 'Content-Type': contentType || 'application/octet-stream' } }, 120_000);
    if (!response.ok) throw await s3Error(response, 'Saving the file');
    await response.arrayBuffer().catch(() => undefined);
  }

  async open(key: string): Promise<StoredFile | null> {
    const response = await this.request(key, { method: 'GET' });
    if (response.status === 404) { await response.arrayBuffer().catch(() => undefined); return null; }
    if (!response.ok || !response.body) throw await s3Error(response, 'Reading the file');
    const length = Number(response.headers.get('content-length'));
    return { body: response.body as ReadableStream<Uint8Array>, size: Number.isFinite(length) && length >= 0 ? length : null, contentType: response.headers.get('content-type') };
  }

  async exists(key: string) {
    const response = await this.request(key, { method: 'HEAD' });
    if (response.status === 404) return false;
    if (!response.ok) throw await s3Error(response, 'Checking the file');
    return true;
  }

  async remove(key: string) {
    const response = await this.request(key, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw await s3Error(response, 'Deleting the file');
    await response.arrayBuffer().catch(() => undefined);
  }
}

const local = () => new LocalStore(env.filesDir);
let cached: { version: number; store: Store } | null = null;

/** The store new files go to (rebuilt when an admin changes the storage settings). */
export function fileStore(): Store {
  const version = settingsVersion();
  if (cached?.version === version) return cached.store;
  const s = settings();
  const store = s.storageProvider === 'wasabi' || s.storageProvider === 's3' ? new BucketStore(bucketConfig(s)) : local();
  cached = { version, store };
  return store;
}

export async function saveFile(key: string, bytes: Uint8Array, contentType: string) {
  await fileStore().put(key, bytes, contentType);
}

/** The file from the store in use, or from this server's disk if it was saved before a switch. */
export async function openFile(key: string): Promise<StoredFile | null> {
  const store = fileStore();
  const found = await store.open(key);
  if (found || store.provider === 'local') return found;
  return local().open(key);
}

export async function readFileBytes(key: string): Promise<Buffer | null> {
  const file = await openFile(key);
  if (!file) return null;
  return Buffer.from(await new Response(file.body).arrayBuffer());
}

/** Removes the file from the store in use and any older copy on this server's disk. */
export async function deleteFile(key: string) {
  const store = fileStore();
  await store.remove(key).catch((error) => console.error(`storage: delete ${key} failed: ${(error as Error).message}`));
  if (store.provider !== 'local') await local().remove(key);
}

/** Saves, reads back and deletes a small file (in the store in use unless another is given). */
export async function testStorage(store: Store = fileStore()) {
  const started = Date.now();
  const key = `videmak-check/${randomUUID()}.txt`;
  const body = new TextEncoder().encode(`Videmak storage check ${new Date().toISOString()}`);
  await store.put(key, body, 'text/plain');
  const read = await store.open(key);
  const text = read ? await new Response(read.body).text() : null;
  await store.remove(key);
  if (text !== new TextDecoder().decode(body)) throw new Error('The test file could not be read back.');
  return { provider: store.provider, ms: Date.now() - started };
}

/* ---- Copying files saved on this server's disk into the bucket ---- */

export type CopyStatus = {
  running: boolean; total: number; copied: number; skipped: number; failed: number;
  started_at: string | null; finished_at: string | null; errors: string[];
};
let copy: CopyStatus = { running: false, total: 0, copied: 0, skipped: 0, failed: 0, started_at: null, finished_at: null, errors: [] };

async function localKeys(dir = env.filesDir, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const keys: string[] = [];
  for (const entry of entries) {
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) keys.push(...(await localKeys(path.join(dir, entry.name), key)));
    else if (entry.isFile() && KEY.test(key) && !key.startsWith('videmak-check/')) keys.push(key);
  }
  return keys;
}

export const copyStatus = () => copy;

/** Copies every file on this server's disk into the bucket in use; never overwrites or deletes. */
export function startCopyToBucket() {
  const store = fileStore();
  if (store.provider === 'local') throw new Error('Choose Wasabi or another S3-compatible store first.');
  if (copy.running) return copy;
  copy = { running: true, total: 0, copied: 0, skipped: 0, failed: 0, started_at: new Date().toISOString(), finished_at: null, errors: [] };
  void (async () => {
    try {
      const keys = await localKeys();
      copy.total = keys.length;
      for (const key of keys) {
        try {
          if (await store.exists(key)) { copy.skipped += 1; continue; }
          await store.put(key, await readFile(path.join(env.filesDir, key)), contentTypeFor(key));
          copy.copied += 1;
        } catch (error) {
          copy.failed += 1;
          if (copy.errors.length < 5) copy.errors.push(`${key}: ${(error as Error).message}`.slice(0, 300));
        }
      }
    } catch (error) {
      copy.errors.push((error as Error).message.slice(0, 300));
    } finally {
      copy.running = false;
      copy.finished_at = new Date().toISOString();
    }
  })();
  return copy;
}

const TYPES: Record<string, string> = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};
export const contentTypeFor = (key: string) => TYPES[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
