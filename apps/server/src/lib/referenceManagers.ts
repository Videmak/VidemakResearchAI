import { createHmac, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { sql } from '../db.js';
import { env } from '../env.js';
import { openSecret, sealSecret, settings } from './settings.js';
import { HARD_UPLOAD_MB } from './plans.js';
import type { ImportEntry } from './libraryImport.js';

/**
 * Zotero and Mendeley as Library sources. Zotero: the person pastes an API key from
 * zotero.org/settings/keys (read access to the library and its files). Mendeley: OAuth with the
 * app an admin registered at dev.mendeley.com. Credentials are sealed with the settings key.
 */

export type Provider = 'zotero' | 'mendeley';
type Connection = { id: string; user_id: string; provider: Provider; external_user_id: string | null; display_name: string | null; credentials_encrypted: string };

const MAX_PDF = HARD_UPLOAD_MB * 1024 * 1024;

export async function connectionOf(userId: string, provider: Provider): Promise<(Connection & { credentials: Record<string, any> }) | null> {
  const [row] = await sql<Connection[]>`select * from library_connections where user_id = ${userId} and provider = ${provider}`;
  if (!row) return null;
  try {
    return { ...row, credentials: JSON.parse(openSecret(row.credentials_encrypted)) };
  } catch {
    return null; // sealed with an older key: connect again
  }
}

async function saveConnection(userId: string, provider: Provider, externalUserId: string, displayName: string, credentials: Record<string, unknown>) {
  await sql`
    insert into library_connections (user_id, provider, external_user_id, display_name, credentials_encrypted)
    values (${userId}, ${provider}, ${externalUserId}, ${displayName}, ${sealSecret(JSON.stringify(credentials))})
    on conflict (user_id, provider) do update set external_user_id = excluded.external_user_id, display_name = excluded.display_name,
      credentials_encrypted = excluded.credentials_encrypted, updated_at = now()`;
}

export async function disconnect(userId: string, provider: Provider) {
  await sql`delete from library_connections where user_id = ${userId} and provider = ${provider}`;
}

export class SourceError extends Error {
  constructor(message: string, readonly status = 422) { super(message); this.name = 'SourceError'; }
}

/** A file behind the API: it answers with a redirect to a signed link, fetched without our credentials. */
async function download(url: string, headers: Record<string, string>): Promise<Uint8Array | null> {
  let response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(60_000) }).catch(() => null);
  const location = response && response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
  if (location) {
    await response!.body?.cancel().catch(() => undefined);
    response = await fetch(new URL(location, url), { redirect: 'follow', signal: AbortSignal.timeout(120_000) }).catch(() => null);
  }
  if (!response?.ok) return null;
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_PDF) { await response.body?.cancel(); return null; }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength <= MAX_PDF ? bytes : null;
}

const yearOf = (value: unknown) => /\d{4}/.exec(String(value ?? ''))?.[0] ?? null;
const doiOf = (value: unknown) => {
  const doi = String(value ?? '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
};

// ------------------------------------------------------------------ Zotero

const ZOTERO = 'https://api.zotero.org';
const zoteroHeaders = (apiKey: string) => ({ 'Zotero-API-Key': apiKey, 'Zotero-API-Version': '3' });

async function zotero(path: string, apiKey: string): Promise<{ data: any; total: number }> {
  const response = await fetch(`${ZOTERO}${path}`, { headers: zoteroHeaders(apiKey), signal: AbortSignal.timeout(30_000) });
  if (response.status === 403) throw new SourceError('Zotero refused the key. Check that it can read your library.', 403);
  if (response.status === 429 || response.status >= 500) throw new SourceError('Zotero is busy. Try again in a minute.', 503);
  if (!response.ok) throw new SourceError(`Zotero answered ${response.status}.`, 502);
  return { data: await response.json(), total: Number(response.headers.get('total-results') || 0) };
}

/** Checks a pasted key with Zotero and remembers it. */
export async function connectZotero(userId: string, apiKey: string) {
  const key = apiKey.trim();
  if (!/^[A-Za-z0-9]{16,40}$/.test(key)) throw new SourceError('That does not look like a Zotero API key.');
  const response = await fetch(`${ZOTERO}/keys/${key}`, { headers: { 'Zotero-API-Version': '3' }, signal: AbortSignal.timeout(20_000) });
  if (response.status === 404 || response.status === 403) throw new SourceError('Zotero does not know this key. Copy it again from zotero.org/settings/keys.');
  if (!response.ok) throw new SourceError('Zotero could not be reached. Try again in a minute.', 503);
  const info: any = await response.json();
  if (!info?.userID || info?.access?.user?.library !== true) throw new SourceError('This key cannot read your library. Create one with "Allow library access" ticked.');
  await saveConnection(userId, 'zotero', String(info.userID), String(info.username || `Zotero user ${info.userID}`), { apiKey: key, files: info.access.user.files === true });
  return { name: String(info.username || ''), files: info.access.user.files === true };
}

// Zotero sign-in (OAuth 1.0a) when an admin registered an app at zotero.org/oauth/apps; the
// access token's secret is a normal API key, checked and stored like a pasted one.
export const zoteroOAuthConfigured = () => Boolean(settings().zoteroClientKey && settings().zoteroClientSecret);
/** ZOTERO_CALLBACK_URL keeps an address an older app registered (a proxy then sends it to the path below). */
export const zoteroCallbackUrl = () => settings().zoteroCallbackUrl || `${settings().publicUrl.replace(/\/$/, '')}/api/library/zotero/callback`;
const oauthEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const pendingZotero = new Map<string, { userId: string; secret: string; next: string; at: number }>();

async function zoteroOAuth(url: string, extra: Record<string, string>, tokenSecret = '') {
  const params: Record<string, string> = {
    oauth_consumer_key: settings().zoteroClientKey, oauth_nonce: randomBytes(16).toString('hex'), oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_version: '1.0', ...extra,
  };
  const base = ['POST', oauthEncode(url), oauthEncode(Object.keys(params).sort().map((key) => `${oauthEncode(key)}=${oauthEncode(params[key])}`).join('&'))].join('&');
  params.oauth_signature = createHmac('sha1', `${oauthEncode(settings().zoteroClientSecret)}&${oauthEncode(tokenSecret)}`).update(base).digest('base64');
  const header = `OAuth ${Object.keys(params).sort().map((key) => `${oauthEncode(key)}="${oauthEncode(params[key])}"`).join(', ')}`;
  const response = await fetch(url, { method: 'POST', headers: { Authorization: header }, signal: AbortSignal.timeout(20_000) });
  const values = new URLSearchParams(await response.text());
  if (!response.ok) throw new SourceError('Zotero did not accept the sign-in. Try again, or paste an API key instead.', 502);
  return values;
}

export async function zoteroAuthorizeUrl(userId: string, next: string) {
  if (!zoteroOAuthConfigured()) throw new SourceError('Zotero sign-in is not set up here. Paste an API key instead.', 503);
  const values = await zoteroOAuth('https://www.zotero.org/oauth/request', { oauth_callback: zoteroCallbackUrl() });
  const token = values.get('oauth_token');
  const secret = values.get('oauth_token_secret');
  if (!token || !secret) throw new SourceError('Zotero did not start the sign-in. Try again.', 502);
  for (const [key, value] of pendingZotero) if (Date.now() - value.at > 15 * 60_000) pendingZotero.delete(key);
  pendingZotero.set(token, { userId, secret, next, at: Date.now() });
  const url = new URL('https://www.zotero.org/oauth/authorize');
  url.search = new URLSearchParams({ oauth_token: token, name: 'Videmak Research AI', library_access: '1', notes_access: '0', write_access: '0', all_groups: 'none' }).toString();
  return url.toString();
}

/** Zotero sends the browser back with the request token and a verifier. Returns where to go next. */
export async function finishZotero(token: string, verifier: string) {
  const pending = pendingZotero.get(token);
  pendingZotero.delete(token);
  if (!pending || Date.now() - pending.at > 15 * 60_000) throw new SourceError('This Zotero sign-in took too long. Try again.', 400);
  const values = await zoteroOAuth('https://www.zotero.org/oauth/access', { oauth_token: token, oauth_verifier: verifier }, pending.secret);
  const apiKey = values.get('oauth_token_secret');
  if (!apiKey) throw new SourceError('Zotero did not finish the sign-in. Try again.', 502);
  await connectZotero(pending.userId, apiKey);
  return pending.next.startsWith('/') && !pending.next.startsWith('//') ? pending.next : '/editor?tool=library';
}

export async function zoteroCollections(userId: string) {
  const connection = await connectionOf(userId, 'zotero');
  if (!connection) throw new SourceError('Connect Zotero first.', 409);
  const collections: { key: string; name: string; parent: string | null; items: number }[] = [];
  for (let start = 0; start < 5000; start += 100) {
    const { data, total } = await zotero(`/users/${connection.external_user_id}/collections?limit=100&start=${start}`, connection.credentials.apiKey);
    for (const item of data as any[]) collections.push({ key: item.key, name: item.data?.name || 'Untitled', parent: item.data?.parentCollection || null, items: item.meta?.numItems ?? 0 });
    if (start + 100 >= total) break;
  }
  const { total } = await zotero(`/users/${connection.external_user_id}/items/top?limit=1&itemType=-attachment`, connection.credentials.apiKey);
  return { collections: collections.sort((a, b) => a.name.localeCompare(b.name)), library_items: total };
}

function zoteroName(creator: any) {
  return creator?.name || [creator?.firstName, creator?.lastName].filter(Boolean).join(' ');
}

/** Every top-level item in the library or one collection, with its first PDF attachment. */
export async function zoteroImport(userId: string, collectionKey: string | null) {
  const found = await connectionOf(userId, 'zotero');
  if (!found) throw new SourceError('Connect Zotero first.', 409);
  const connection = found;
  const base = `/users/${connection.external_user_id}`;
  const apiKey: string = connection.credentials.apiKey;
  const list = collectionKey ? `${base}/collections/${encodeURIComponent(collectionKey)}/items/top` : `${base}/items/top`;
  const first = await zotero(`${list}?limit=1&itemType=-attachment`, apiKey);
  async function* entries(): AsyncGenerator<ImportEntry> {
    for (let start = 0; start < 20_000; start += 100) {
      // Top-level items without stand-alone files; stand-alone notes have no title and are skipped below.
      const { data, total } = await zotero(`${list}?limit=100&start=${start}&itemType=-attachment`, apiKey);
      for (const item of data as any[]) {
        const fields = item.data || {};
        const title = String(fields.title || fields.caseName || fields.nameOfAct || '').trim();
        if (!title) continue;
        yield {
          title,
          authors: (fields.creators || []).filter((creator: any) => !creator.creatorType || ['author', 'editor', 'contributor'].includes(creator.creatorType)).map(zoteroName).filter(Boolean),
          year: yearOf(fields.date),
          doi: doiOf(fields.DOI || (/\bDOI:\s*(\S+)/i.exec(fields.extra || '')?.[1])),
          journal: fields.publicationTitle || fields.bookTitle || fields.proceedingsTitle || fields.publisher || null,
          url: fields.url || null,
          abstract: fields.abstractNote || null,
          externalId: `zotero:${connection.external_user_id}:${item.key}`,
          metadata: { zotero_key: item.key, item_type: fields.itemType },
          pdf: connection.credentials.files && (item.meta?.numChildren ?? 0) > 0 ? async () => {
            const { data: children } = await zotero(`${base}/items/${item.key}/children`, apiKey);
            const attachment = (children as any[]).find((child) => child.data?.itemType === 'attachment' && child.data?.contentType === 'application/pdf'
              && ['imported_file', 'imported_url'].includes(child.data?.linkMode));
            return attachment ? download(`${ZOTERO}${base}/items/${attachment.key}/file`, zoteroHeaders(apiKey)) : null;
          } : null,
        };
      }
      if (start + 100 >= total) break;
    }
    await sql`update library_connections set last_import_at = now() where id = ${connection.id}`;
  }
  return { total: first.total, entries: entries() };
}

// ------------------------------------------------------------------ Mendeley

const MENDELEY = 'https://api.mendeley.com';
export const mendeleyConfigured = () => Boolean(settings().mendeleyClientId && settings().mendeleyClientSecret);
export const mendeleyRedirectUri = () => `${settings().publicUrl.replace(/\/$/, '')}/api/library/mendeley/callback`;
const stateKey = () => new TextEncoder().encode(`${env.jwtSecret}:mendeley-oauth`);

export async function mendeleyAuthorizeUrl(userId: string, next: string) {
  if (!mendeleyConfigured()) throw new SourceError('Mendeley is not set up on this site yet. Export a .bib file from Mendeley and use Import .bib/.ris.', 503);
  const state = await new SignJWT({ next }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setExpirationTime('15m').sign(stateKey());
  const url = new URL(`${MENDELEY}/oauth/authorize`);
  url.search = new URLSearchParams({ client_id: settings().mendeleyClientId, redirect_uri: mendeleyRedirectUri(), response_type: 'code', scope: 'all', state }).toString();
  return url.toString();
}

async function mendeleyToken(body: Record<string, string>) {
  const basic = Buffer.from(`${settings().mendeleyClientId}:${settings().mendeleyClientSecret}`).toString('base64');
  const response = await fetch(`${MENDELEY}/oauth/token`, {
    method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body), signal: AbortSignal.timeout(20_000),
  });
  const json: any = await response.json().catch(() => null);
  if (!response.ok || !json?.access_token) throw new SourceError('Mendeley did not accept the sign-in. Try connecting again.', 401);
  return { accessToken: json.access_token as string, refreshToken: (json.refresh_token as string) || body.refresh_token, expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000 };
}

/** The browser comes back from Mendeley: exchange the code, remember the account. Returns where to go next. */
export async function finishMendeley(code: string, state: string) {
  const { payload } = await jwtVerify(state, stateKey()).catch(() => { throw new SourceError('This Mendeley sign-in took too long. Try again.', 400); });
  const userId = String(payload.sub);
  const tokens = await mendeleyToken({ grant_type: 'authorization_code', code, redirect_uri: mendeleyRedirectUri() });
  const profile: any = await fetch(`${MENDELEY}/profiles/me`, { headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/vnd.mendeley-profiles.1+json' } })
    .then((response) => (response.ok ? response.json() : null)).catch(() => null);
  await saveConnection(userId, 'mendeley', String(profile?.id || ''), String(profile?.display_name || profile?.email || 'Mendeley'), tokens);
  return typeof payload.next === 'string' && payload.next.startsWith('/') && !payload.next.startsWith('//') ? payload.next : '/editor?tool=library';
}

async function mendeleyAccess(userId: string) {
  const connection = await connectionOf(userId, 'mendeley');
  if (!connection) throw new SourceError('Connect Mendeley first.', 409);
  let tokens = connection.credentials as { accessToken: string; refreshToken: string; expiresAt: number };
  if (tokens.expiresAt - 60_000 < Date.now()) {
    tokens = await mendeleyToken({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, redirect_uri: mendeleyRedirectUri() });
    await saveConnection(userId, 'mendeley', connection.external_user_id || '', connection.display_name || 'Mendeley', tokens);
  }
  return { connection, token: tokens.accessToken };
}

async function mendeley(url: string, token: string, accept: string): Promise<{ data: any; next: string | null; total: number }> {
  const response = await fetch(url.startsWith('http') ? url : `${MENDELEY}${url}`, { headers: { Authorization: `Bearer ${token}`, Accept: accept }, signal: AbortSignal.timeout(30_000) });
  if (response.status === 401) throw new SourceError('Mendeley signed you out. Connect again.', 401);
  if (response.status === 429 || response.status >= 500) throw new SourceError('Mendeley is busy. Try again in a minute.', 503);
  if (!response.ok) throw new SourceError(`Mendeley answered ${response.status}.`, 502);
  const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') || '')?.[1] ?? null;
  return { data: await response.json(), next, total: Number(response.headers.get('mendeley-count') || 0) };
}

export async function mendeleyFolders(userId: string) {
  const { token } = await mendeleyAccess(userId);
  const folders: { id: string; name: string; parent: string | null }[] = [];
  let url: string | null = '/folders?limit=500';
  while (url) {
    const page: { data: any[]; next: string | null } = await mendeley(url, token, 'application/vnd.mendeley-folder.1+json');
    for (const folder of page.data) folders.push({ id: folder.id, name: folder.name || 'Untitled', parent: folder.parent_id || null });
    url = page.next;
  }
  return { folders: folders.sort((a, b) => a.name.localeCompare(b.name)) };
}

const DOCUMENT = 'application/vnd.mendeley-document.1+json';

/** The documents of the whole library, or of one folder (the folder lists ids; each is then read). */
async function* mendeleyDocuments(token: string, folderId: string | null): AsyncGenerator<any> {
  if (!folderId) {
    let page: { data: any[]; next: string | null } | null = await mendeley('/documents?view=all&limit=500', token, DOCUMENT);
    while (page) {
      yield* page.data;
      page = page.next ? await mendeley(page.next, token, DOCUMENT) : null;
    }
    return;
  }
  let page: { data: any[]; next: string | null } | null = await mendeley(`/folders/${encodeURIComponent(folderId)}/documents?limit=500`, token, DOCUMENT);
  while (page) {
    for (const { id } of page.data) {
      const one = await mendeley(`/documents/${encodeURIComponent(id)}?view=all`, token, DOCUMENT).catch(() => null);
      if (one) yield one.data;
    }
    page = page.next ? await mendeley(page.next, token, DOCUMENT) : null;
  }
}

export async function mendeleyImport(userId: string, folderId: string | null) {
  const { connection, token } = await mendeleyAccess(userId);
  const counted = await mendeley(folderId ? `/folders/${encodeURIComponent(folderId)}/documents?limit=1` : '/documents?limit=1', token, DOCUMENT);
  async function* entries(): AsyncGenerator<ImportEntry> {
    for await (const document of mendeleyDocuments(token, folderId)) {
        const title = String(document.title || '').trim();
        if (!title) continue;
        yield {
          title,
          authors: (document.authors || []).map((author: any) => [author.first_name, author.last_name].filter(Boolean).join(' ')).filter(Boolean),
          year: document.year ? String(document.year) : null,
          doi: doiOf(document.identifiers?.doi),
          journal: document.source || null,
          url: document.websites?.[0] || null,
          abstract: document.abstract || null,
          externalId: `mendeley:${connection.external_user_id}:${document.id}`,
          metadata: { mendeley_id: document.id, item_type: document.type },
          pdf: document.file_attached !== false ? async () => {
            const { data: files } = await mendeley(`/files?document_id=${document.id}`, token, 'application/vnd.mendeley-file.1+json');
            const file = (files as any[]).find((item) => item.mime_type === 'application/pdf');
            return file ? download(`${MENDELEY}/files/${file.id}`, { Authorization: `Bearer ${token}`, Accept: '*/*' }) : null;
          } : null,
        };
    }
    await sql`update library_connections set last_import_at = now() where id = ${connection.id}`;
  }
  return { total: counted.total, entries: entries() };
}
