import { zoteroItemToBibtex } from '../lib/thesis-manuscript/citations';
import { getHost } from '../helpers/getHost';
import { generateCitation } from './citationApi';
import { postDurableForm } from './jobsApi';
import { getAuthToken } from './auth/api';
import { getDocument, type LibraryDocumentResponse } from './libraryApi';

type CitationSource = 'stored' | 'zotero' | 'service' | 'pdf' | 'fallback';

export interface ResolvedLibraryCitation {
  document: LibraryDocumentResponse;
  bibtex: string;
  source: CitationSource;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function firstString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function firstMetadataString(
  metadata: Record<string, unknown>,
  keys: string[],
): string | undefined {
  return firstString(...keys.map((key) => metadata[key]));
}

function isPdfDocument(document: LibraryDocumentResponse): boolean {
  const fileType = document.file_type?.toLowerCase() || '';
  const filename = document.filename?.toLowerCase() || '';
  return fileType.includes('pdf') || filename.endsWith('.pdf');
}

function escapeBibtexValue(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

function slugifySegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

function extractYear(value?: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match?.[0];
}

function normalizeAuthorName(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return firstString(value);
  }
  const author = toRecord(value);
  const nestedName = toRecord(author.name);
  const literal = firstString(author.literal, author.name, nestedName.literal);
  if (literal) return literal;

  const family = firstString(
    author.family,
    author.lastName,
    author.last_name,
    nestedName.family,
    nestedName.lastName,
    nestedName.last_name,
  );
  const given = firstString(
    author.given,
    author.firstName,
    author.first_name,
    nestedName.given,
    nestedName.firstName,
    nestedName.first_name,
  );
  if (family && given) return `${family}, ${given}`;
  return family || given;
}

function normalizeAuthors(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .map(normalizeAuthorName)
    .filter((author): author is string => Boolean(author));
}

function buildFallbackBibtex(document: LibraryDocumentResponse): string | null {
  const metadata = toRecord(document.metadata);
  const title = firstString(document.title, metadata.title, document.filename);
  if (!title) return null;

  const documentAuthors = normalizeAuthors(document.authors);
  const authors = documentAuthors.length > 0
    ? documentAuthors
    : normalizeAuthors(metadata.authors);

  const year = extractYear(document.publication_date) || extractYear(firstMetadataString(metadata, ['year', 'issuedDate', 'date']));
  const doi = firstString(document.doi, metadata.doi);
  const url = firstMetadataString(metadata, ['original_url', 'source_url', 'url', 'landing_page_url', 'pdf_url']);
  const publisher = firstString(document.publisher, metadata.publisher);
  const journal = firstMetadataString(metadata, ['journal', 'publicationTitle', 'booktitle', 'bookTitle']);
  const keySeed = slugifySegment(authors[0] || title) || document.id.slice(0, 8).toLowerCase();
  const bibtexKey = `${keySeed}${year || 'nd'}`;

  const fields = [
    `title = {${escapeBibtexValue(title)}}`,
    authors.length > 0
      ? `author = {${authors.map((author) => escapeBibtexValue(author)).join(' and ')}}`
      : null,
    year ? `year = {${year}}` : null,
    journal ? `journal = {${escapeBibtexValue(journal)}}` : null,
    publisher ? `publisher = {${escapeBibtexValue(publisher)}}` : null,
    doi ? `doi = {${escapeBibtexValue(doi)}}` : null,
    url ? `url = {${escapeBibtexValue(url)}}` : null,
  ].filter(Boolean);

  return `@misc{${bibtexKey},\n  ${fields.join(',\n  ')}\n}`;
}

async function importViaZoteroTranslation(input: string): Promise<Record<string, unknown>[]> {
  const formData = new FormData();
  formData.append('file', new Blob([input], { type: 'text/plain' }), 'citation-input.txt');

  const response = await fetch('/api/zotero/import', {
    method: 'POST',
    body: formData,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.success || !Array.isArray(data.items)) {
    throw new Error(data?.error || 'Failed to import via Zotero translation server');
  }

  return data.items as Record<string, unknown>[];
}

async function fetchLibraryDocumentBlob(documentId: string, groupLibraryId?: string | null): Promise<Blob> {
  const token = getAuthToken();
  const params = new URLSearchParams({ t: String(Date.now()) });
  if (groupLibraryId) params.set('group_library_id', groupLibraryId);
  const response = await fetch(`/api/library/documents/${documentId}/file?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch the library document.');
  }

  return response.blob();
}

async function getBibTeXForPDF(pdfBlob: Blob): Promise<string | null> {
  const host = getHost();
  const formData = new FormData();
  formData.append('file', pdfBlob, 'document.pdf');
  formData.append('style', 'bibtex');
  formData.append('format', 'text');

  const result = await postDurableForm<any>(
    `${host}/api/citations/upload`,
    formData,
  ).catch(() => null);
  if (!result) return null;
  if (typeof result?.bibtex === 'string' && result.bibtex.trim().startsWith('@')) {
    return result.bibtex.trim();
  }

  const firstBibliography = Array.isArray(result?.bibliography) ? result.bibliography[0] : null;
  if (typeof firstBibliography === 'string' && firstBibliography.trim().startsWith('@')) {
    return firstBibliography.trim();
  }

  return null;
}

async function resolveBibtexFromIdentifier(
  identifier: string,
  style: string,
): Promise<{ bibtex: string; source: CitationSource } | null> {
  try {
    const items = await importViaZoteroTranslation(identifier);
    const bibtex = items
      .map((item, index) => zoteroItemToBibtex(item, index))
      .find((entry): entry is string => typeof entry === 'string' && entry.trim().startsWith('@'));

    if (bibtex) {
      return { bibtex: bibtex.trim(), source: 'zotero' };
    }
  } catch {
    // Fall through to the citation service.
  }

  const citation = await generateCitation({
    input: identifier,
    style,
    format: 'bibtex',
  });

  const bibtex =
    firstString(citation.bibtex) ||
    (Array.isArray(citation.bibliography) ? firstString(citation.bibliography[0]) : undefined);

  if (bibtex?.startsWith('@')) {
    return { bibtex, source: 'service' };
  }

  return null;
}

export async function resolveLibraryCitationBibtex(
  document: LibraryDocumentResponse,
  style: string = 'apa',
): Promise<ResolvedLibraryCitation> {
  const fullDocument = await getDocument(document.id, document.group_library_id).catch(() => document);
  const metadata = toRecord(fullDocument.metadata);

  const storedBibtex = firstMetadataString(metadata, ['bibtex']);
  if (storedBibtex?.startsWith('@')) {
    return {
      document: fullDocument,
      bibtex: storedBibtex,
      source: 'stored',
    };
  }

  const doi = firstString(fullDocument.doi, metadata.doi);
  const pmid = firstMetadataString(metadata, ['pmid']);
  const url = firstMetadataString(metadata, [
    'original_url',
    'source_url',
    'url',
    'landing_page_url',
  ]);

  const identifierCandidates = [
    doi,
    pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : undefined,
    url,
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);

  for (const candidate of identifierCandidates) {
    const resolved = await resolveBibtexFromIdentifier(candidate, style);
    if (resolved) {
      return {
        document: fullDocument,
        bibtex: resolved.bibtex,
        source: resolved.source,
      };
    }
  }

  if (isPdfDocument(fullDocument)) {
    const pdfBlob = await fetchLibraryDocumentBlob(fullDocument.id, fullDocument.group_library_id).catch(() => null);
    if (pdfBlob) {
      const pdfBibtex = await getBibTeXForPDF(pdfBlob);
      if (pdfBibtex?.startsWith('@')) {
        return {
          document: fullDocument,
          bibtex: pdfBibtex,
          source: 'pdf',
        };
      }
    }
  }

  const fallbackBibtex = buildFallbackBibtex(fullDocument);
  if (fallbackBibtex) {
    return {
      document: fullDocument,
      bibtex: fallbackBibtex,
      source: 'fallback',
    };
  }

  throw new Error('No citation metadata was available for this reference.');
}
