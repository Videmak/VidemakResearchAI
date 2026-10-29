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
