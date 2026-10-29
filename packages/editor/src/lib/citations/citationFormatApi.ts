import { getApiBase } from '../../utils/auth/api';

export interface CitationFormatEntry {
  id?: string;
  bibtex: string;
  index?: number;
}

export interface CitationFormatResult {
  id?: string;
  inText?: string | null;
  bibliography?: string | null;
  formatted?: string | null;
  success: boolean;
  error?: string;
}

function apiBase(): string {
  return `${getApiBase()}/api/citations`;
}

function activeCslLocale(): string {
  if (typeof window === 'undefined') return 'en-US';
  const language = window.localStorage.getItem('researchAgent_documentLanguage') || 'en';
  const base = language.split('-')[0].toLowerCase();
  return ({ en: 'en-US', fr: 'fr-FR', es: 'es-ES', ar: 'ar' } as Record<string, string>)[base] || language;
}

async function postFormatter(path: string, payload: unknown): Promise<any> {
  const response = await fetch(`${apiBase()}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `Citation formatter failed (${response.status})`);
  }
  return data;
}

export async function formatCitationBatch(
  entries: CitationFormatEntry[],
  style: string,
): Promise<CitationFormatResult[]> {
  if (entries.length === 0) return [];
  const data = await postFormatter('format/batch', { entries, style, locale: activeCslLocale() });
  if (!Array.isArray(data.results) || data.results.length !== entries.length) {
    throw new Error('Citation formatter returned an incomplete batch');
  }
  data.results.forEach((result: CitationFormatResult, index: number) => {
    if (!result?.success || !result.bibliography) {
      throw new Error(result?.error || `Citation ${index + 1} could not be formatted`);
    }
  });
  return data.results;
}

export async function formatCitationEntry(
  entry: CitationFormatEntry,
  style: string,
): Promise<CitationFormatResult> {
  const data = await postFormatter('format', { bibtex: entry.bibtex, style, locale: activeCslLocale() });
  if (!data.bibliography) {
    throw new Error('Citation formatter returned no bibliography entry');
  }
  return { ...data, id: entry.id, success: true };
}

export async function formatInTextCitation(
  bibtex: string,
  style: string,
  index: number,
): Promise<string> {
  const data = await postFormatter('format/intext', { bibtex, style, index, locale: activeCslLocale() });
  if (!data.inText) {
    throw new Error('Citation formatter returned no in-text citation');
  }
  return data.inText;
}
