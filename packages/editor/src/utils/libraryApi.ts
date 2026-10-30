import { getApiBase, getAuthHeader } from './auth/api';
import { notePlanLimit } from '../lib/planLimit';

/** The person's Library as the editor sees it (papers and uploaded PDFs). */
export interface LibraryDocumentResponse {
  id: string;
  user_id: number | string;
  group_library_id?: string | null;
  filename: string;
  file_type: string;
  file_path?: string;
  file_size?: number;
  title?: string;
  authors?: string[];
  doi?: string;
  publisher?: string;
  publication_date?: string;
  abstract?: string;
  metadata?: Record<string, unknown>;
  folder_id?: string;
  processing_status: string;
  processing_error?: string;
  chunk_count: number;
  total_tokens?: number;
  created_at: string;
  updated_at?: string;
  last_viewed_at?: string;
  processed_at?: string;
  is_my_publication?: boolean;
  deleted_at?: string | null;
}

export interface DocumentUploadResponse {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  processing_status: string;
  message: string;
  job_id?: string | null;
  reason_code?: string | null;
  upgrade_url?: string | null;
}

export interface DocumentListResponse {
  documents: LibraryDocumentResponse[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface DocumentListParams {
  group_library_id?: string;
  folder_id?: string;
  unfiled_only?: boolean;
  view?: string;
  status?: string;
  file_type?: string;
  search?: string;
  page?: number;
  page_size?: number;
  order_by?: string;
  order_desc?: boolean;
}

export interface FolderResponse {
  id: string;
  group_library_id?: string | null;
  name: string;
  description?: string;
  parent_id: string | null;
  source: 'local' | 'zotero' | 'mendeley';
  zotero_key?: string;
  mendeley_key?: string;
  document_count: number;
  created_at: string;
  updated_at?: string;
  color?: string;
  icon?: string;
  sort_order?: number;
  order?: number;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, { ...init, headers: { ...getAuthHeader(), ...(init.headers || {}) } });
  const body = await response.json().catch(() => null);
  if (response.status === 402) notePlanLimit(body?.detail, true);
  if (!response.ok) throw new Error((body && (body.detail || body.error)) || `Library request failed (${response.status})`);
  return body as T;
}

export async function getDocuments(params: DocumentListParams = {}): Promise<DocumentListResponse> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') query.set(key, String(value)); });
  return request<DocumentListResponse>(`/api/library/documents${query.toString() ? `?${query}` : ''}`);
}

export async function getDocument(documentId: string, _groupLibraryId?: string | null): Promise<LibraryDocumentResponse> {
  return request<LibraryDocumentResponse>(`/api/library/documents/${encodeURIComponent(documentId)}`);
}

export async function getFolders(_params?: { group_library_id?: string }): Promise<FolderResponse[]> {
  return request<FolderResponse[]>('/api/library/folders');
}

export async function uploadDocument(
  file: File,
  options?: { folder_id?: string; group_library_id?: string; title?: string; useProxy?: boolean },
): Promise<DocumentUploadResponse> {
  const form = new FormData();
  form.append('file', file);
  if (options?.folder_id) form.append('folder_id', options.folder_id);
  if (options?.title) form.append('title', options.title);
  return request<DocumentUploadResponse>('/api/library/documents/upload', { method: 'POST', body: form });
}

/** What the add dialog may do on the person's plan. */
export interface LibraryLimits {
  plan: { id: string; name: string; is_default: boolean };
  pdfs_used: number;
  pdfs_limit: number | null;
  pdfs_left: number | null;
  upload_mb: number;
  upload_batch: number;
  zotero_import: boolean;
  mendeley_import: boolean;
}

export const getLibraryLimits = () => request<LibraryLimits>('/api/library/limits');

/** One PDF upload with progress (0–1). A plan limit (402) opens the upgrade offer. */
export function uploadDocumentWithProgress(
  file: File,
  options: { folder_id?: string | null; signal?: AbortSignal },
  onProgress: (share: number) => void,
): Promise<DocumentUploadResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    if (options.folder_id) form.append('folder_id', options.folder_id);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${getApiBase()}/api/library/documents/upload`);
    for (const [name, value] of Object.entries(getAuthHeader())) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    xhr.onload = () => {
      let body: any = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 402) notePlanLimit(body?.detail);
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as DocumentUploadResponse);
      else reject(Object.assign(new Error(body?.detail || `The upload failed (${xhr.status}).`), { status: xhr.status }));
    };
    xhr.onerror = () => reject(new Error('The connection dropped. Try again.'));
    xhr.onabort = () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

/** An import running in the background (Zotero, Mendeley, .bib/.ris, pasted ids). */
export interface ImportJob {
  id: string;
  source: 'zotero' | 'mendeley' | 'bibtex' | 'ris' | 'ids';
  label: string;
  status: 'running' | 'done' | 'failed';
  total: number;
  added: number;
  pdfs: number;
  skipped: number;
  failed: number;
  pdfs_over_limit: number;
  error: string | null;
}

export const getImportJob = (id: string) => request<ImportJob>(`/api/library/import/jobs/${id}`);

export function importReferenceFile(file: File, options: { folder_id?: string | null; find_pdfs: boolean }) {
  const form = new FormData();
  form.append('file', file);
  if (options.folder_id) form.append('folder_id', options.folder_id);
  form.append('find_pdfs', String(options.find_pdfs));
  return request<{ job_id: string; total: number }>('/api/library/import/file', { method: 'POST', body: form });
}

export const importIds = (text: string, options: { folder_id?: string | null; find_pdfs: boolean }) =>
  request<{ job_id: string; total: number }>('/api/library/import/ids', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, folder_id: options.folder_id || null, find_pdfs: options.find_pdfs }),
  });

/** Zotero and Mendeley: whether connected, and how each connects on this site. */
export interface LibraryConnections {
  zotero: { connected: boolean; name: string | null; last_import_at: string | null; sign_in: boolean; api_key: boolean };
  mendeley: { connected: boolean; name: string | null; last_import_at: string | null; sign_in: boolean };
}
export type ReferenceProvider = 'zotero' | 'mendeley';
export type ReferenceCollection = { id: string; name: string; parent: string | null; items: number | null };

export const getLibraryConnections = () => request<LibraryConnections>('/api/library/connections');

export const connectZoteroKey = (apiKey: string) =>
  request<{ name: string; files: boolean }>('/api/library/zotero/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: apiKey }) });

export const startReferenceSignIn = (provider: ReferenceProvider, next: string) =>
  request<{ authorization_url: string }>(`/api/library/${provider}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ next }) });

export const disconnectReferenceManager = (provider: ReferenceProvider) => request<{ ok: true }>(`/api/library/connections/${provider}`, { method: 'DELETE' });

/** The collections (Zotero) or folders (Mendeley) to pick from, and the whole library's size when known. */
export async function getReferenceCollections(provider: ReferenceProvider): Promise<{ collections: ReferenceCollection[]; library_items: number | null }> {
  if (provider === 'zotero') {
    const result = await request<{ collections: { key: string; name: string; parent: string | null; items: number }[]; library_items: number }>('/api/library/zotero/collections');
    return { collections: result.collections.map((item) => ({ id: item.key, name: item.name, parent: item.parent, items: item.items })), library_items: result.library_items };
  }
  const result = await request<{ folders: { id: string; name: string; parent: string | null }[] }>('/api/library/mendeley/folders');
  return { collections: result.folders.map((item) => ({ ...item, items: null })), library_items: null };
}

export const startReferenceImport = (provider: ReferenceProvider, options: { collection: string | null; collection_name: string | null; folder_id: string | null; find_pdfs: boolean }) =>
  request<{ job_id: string; total: number; folder_id: string | null }>(`/api/library/${provider}/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options),
  });
