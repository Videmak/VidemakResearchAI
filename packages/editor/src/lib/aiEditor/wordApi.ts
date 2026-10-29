'use client';

import { getAuthHeader } from '../../utils/auth/api';
import type { WordSettings } from './wordSchema';
import { notePlanLimit } from '../planLimit';

/** Word files in and out of the AI Editor (converted by workers/convert). */

export const WORD_OPENABLE = /\.(docx|docm|dotx|doc|dot|odt|rtf)$/i;

export type WordImportResult = {
  document: { id: string; title: string; [key: string]: unknown };
  blocks: any[];
  comments: any[];
  settings: WordSettings | null;
  warnings: string[];
  stats: Record<string, number>;
  title: string;
};

async function failure(response: Response, fallback: string): Promise<Error> {
  try {
    const body = await response.json();
    if (response.status === 402) notePlanLimit(body?.detail, true);
    if (typeof body?.detail === 'string') return new Error(body.detail);
  } catch {
    /* not JSON */
  }
  return new Error(fallback);
}

/** Opens a Word file: into `documentId` (replacing its content) or as a new document. */
export async function importWordFile(file: File, documentId?: string | null): Promise<WordImportResult> {
  const form = new FormData();
  form.append('file', file);
  if (documentId) form.append('document_id', documentId);
  const response = await fetch('/api/ai-editor/word/import', { method: 'POST', headers: getAuthHeader(), body: form });
  if (!response.ok) throw await failure(response, 'This file could not be opened.');
  return response.json();
}

export type WordExportPayload = {
  documentId?: string | null;
  title: string;
  blocks: any[];
  comments?: any[];
  settings?: WordSettings | null;
  format: 'docx' | 'pdf' | 'latex';
};

export async function exportWordDocument(payload: WordExportPayload): Promise<Blob> {
  const response = await fetch('/api/ai-editor/word/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({
      document_id: payload.documentId || undefined,
      title: payload.title,
      blocks: payload.blocks,
      comments: payload.comments,
      settings: payload.settings || undefined,
      format: payload.format,
    }),
  });
  if (!response.ok) throw await failure(response, 'The document could not be exported.');
  return response.blob();
}

/** Stores an image for the editor and returns its URL (instead of embedding it in the document). */
export async function uploadEditorAsset(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/ai-editor/assets', { method: 'POST', headers: getAuthHeader(), body: form });
  if (!response.ok) throw await failure(response, 'The image could not be added.');
  const body = await response.json();
  return body.url;
}
