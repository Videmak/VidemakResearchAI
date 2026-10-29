/**
 * Citation Service using Citation.js
 * 
 * Handles all citation formatting using Citation.js library.
 * - Decodes BASE64 BibTeX from citation spans
 * - Formats in-text citations based on selected style
 * - Generates bibliography/references
 * - All processing happens in frontend - no API calls needed
 * 
 * @see https://citation.js.org/
 */

// @ts-ignore - Citation.js doesn't have perfect TypeScript types
import { Cite, plugins } from '@citation-js/core';
import '@citation-js/plugin-csl';
import '@citation-js/plugin-bibtex';
import { isNumericStyle as isNumericCslStyle, normalizeStyleId } from './cslStyles';
import { normalizeCslItems } from './cslDataNormalizer';

// ============================================================================
// Types
// ============================================================================

export interface CitationData {
  id: string;
  bibtex: string;
  inTextCitation: string;
  fullReference: string;
}

export interface FormattedCitation {
  inText: string;
  bibliography: string;
}

export interface DecodedCitationPayload {
  bibtex: string;
  citation_metadata?: {
    id?: string;
    title?: string;
    authors?: string[];
    year?: string | number | null;
    doi?: string | null;
    url?: string | null;
    journal?: string | null;
    volume?: string | null;
    issue?: string | null;
    pages?: string | null;
  };
  evidence_pages?: number[];
  printed_page_labels?: string[];
  evidence?: Array<{
    page_number?: number | null;
    printed_page_label?: string | null;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export function getEvidencePageLabel(payload: DecodedCitationPayload | null): string {
  if (!payload) return '';
  const printed = Array.from(new Set((payload.printed_page_labels || []).filter(Boolean)));
  if (printed.length > 0) return printed.join(', ');
  const pages = Array.from(new Set([
    ...(payload.evidence_pages || []),
    ...((payload.evidence || []).map((item) => item.page_number).filter((page): page is number => typeof page === 'number')),
  ])).sort((a, b) => a - b);
  if (pages.length === 0) return '';
  const ranges: string[] = [];
  let start = pages[0];
  let previous = pages[0];
  for (const page of pages.slice(1)) {
    if (page === previous + 1) {
      previous = page;
      continue;
    }
    ranges.push(start === previous ? `${start}` : `${start}–${previous}`);
    start = previous = page;
  }
  ranges.push(start === previous ? `${start}` : `${start}–${previous}`);
  return ranges.join(', ');
}

// Legacy aliases for built-in Citation.js template names. For modern CSL styles,
// use the normalized style ID directly so dynamically loaded templates are honored.
export const STYLE_TEMPLATES: Record<string, string> = {
  'harvard': 'harvard1',
  'harvard1': 'harvard1',
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Decode BASE64 string to get citation data (BibTeX or JSON)
 */
export function decodeCitationFromBase64(base64: string): string | null {
  try {
    // Handle both browser and Node.js environments
    if (typeof window !== 'undefined') {
      return decodeURIComponent(escape(atob(base64)));
    } else {
      return Buffer.from(base64, 'base64').toString('utf-8');
    }
  } catch (e) {
    // Try simple atob
    try {
      return atob(base64);
    } catch {
      console.error('Error decoding BASE64:', e);
      return null;
    }
  }
}

/**
 * Convert old JSON citation format to BibTeX
 */
export function jsonCitationToBibtex(jsonData: any): string {
  try {
    // Handle array format (old format)
    const item = Array.isArray(jsonData) ? jsonData[0] : jsonData;
    const work = item?.work || item;
    
    // Extract data from the old format
    const contributors = work?.contributors || [];
    const title = work?.title || 'Untitled';
    const year = work?.issuedDate ? work.issuedDate.substring(0, 4) : 'n.d.';
    const doi = work?.ids?.doi || '';
    const url = work?.url || '';
    const journal = work?.containerInfo?.title || '';
    const externalId = item?.externalCacheId || `cite-${Date.now()}`;
    
    // Format authors for BibTeX - Last, First and Last, First
    const authors = contributors.map((c: any) => {
      const name = c?.name;
      if (!name) return 'Unknown';
      const family = name.family || '';
      const given = name.given || '';
      if (family && given) return `${family}, ${given}`;
      return family || given || 'Unknown';
    }).filter(Boolean).join(' and ') || 'Unknown';
    
    // Build BibTeX entry - no trailing commas on last field
    const fields: string[] = [];
    fields.push(`author = {${authors}}`);
    fields.push(`title = {${title}}`);
    fields.push(`year = {${year}}`);
    if (journal) fields.push(`journal = {${journal}}`);
    if (doi) fields.push(`doi = {${doi}}`);
    if (url) fields.push(`url = {${url}}`);
    
    return `@article{${externalId},\n  ${fields.join(',\n  ')}\n}`;
  } catch (e) {
    console.error('Error converting JSON to BibTeX:', e);
    return '';
  }
}

/**
 * Check if string is BibTeX format
 */
export function isBibtexFormat(data: string): boolean {
  return data.trim().startsWith('@');
}

/**
 * Get BibTeX from BASE64 data (handles BibTeX strings, rich JSON payloads, and legacy Generator JSON)
 */
export function getBibtexFromBase64(base64: string): string | null {
  const decoded = decodeCitationFromBase64(base64);
  if (!decoded) return null;

  // Legacy BibTeX format: starts with '@'
  if (isBibtexFormat(decoded)) {
    return decoded;
  }

  // Try to parse as JSON
  try {
    const jsonData = JSON.parse(decoded);

    // New rich payload format: { bibtex, year, author, bibliography, ... }
    if (jsonData && typeof jsonData.bibtex === 'string' && jsonData.bibtex.trim().startsWith('@')) {
      return jsonData.bibtex.trim();
    }

    // Legacy Generator mode format: { work: { ... } }
    return jsonCitationToBibtex(jsonData);
  } catch {
    console.warn('Could not parse citation data:', decoded.substring(0, 100));
    return null;
  }
}

/**
 * Decode a citation payload and preserve rich metadata when present.
 */
export function getDecodedCitationPayload(base64: string): DecodedCitationPayload | null {
  const decoded = decodeCitationFromBase64(base64);
  if (!decoded) return null;

  if (isBibtexFormat(decoded)) {
    return { bibtex: decoded };
  }

  try {
    const jsonData = JSON.parse(decoded);
    if (jsonData && typeof jsonData.bibtex === 'string' && jsonData.bibtex.trim().startsWith('@')) {
      return jsonData as DecodedCitationPayload;
    }

    const bibtex = jsonCitationToBibtex(jsonData);
    return bibtex ? { bibtex } : null;
  } catch {
    return null;
  }
}

/**
 * Build a stable fingerprint so duplicate sources are merged even if they
 * were inserted with different transient citation IDs.
 */
export function getCitationFingerprint(bibtex: string): string {
  const doiMatch = bibtex.match(/doi\s*=\s*\{([^}]+)\}/i);
  if (doiMatch?.[1]) {
    return `doi:${doiMatch[1].trim().toLowerCase()}`;
  }

  const urlMatch = bibtex.match(/url\s*=\s*\{([^}]+)\}/i);
  if (urlMatch?.[1]) {
    return `url:${urlMatch[1].trim().toLowerCase()}`;
  }

  const keyMatch = bibtex.match(/@\w+\{([^,]+),/);
  if (keyMatch?.[1]) {
    return `key:${keyMatch[1].trim().toLowerCase()}`;
  }

  const normalized = bibtex.replace(/\s+/g, ' ').trim().toLowerCase();
  return `raw:${normalized}`;
}

/**
 * Encode BibTeX to BASE64
 */
export function encodeBibtexToBase64(bibtex: string): string {
  try {
    if (typeof window !== 'undefined') {
      return btoa(unescape(encodeURIComponent(bibtex)));
    } else {
      return Buffer.from(bibtex, 'utf-8').toString('base64');
    }
  } catch (e) {
    console.error('Error encoding to BASE64:', e);
    return '';
  }
}

/**
 * Get CSL template name from style string
 */
export function getTemplateForStyle(style: string): string {
  const normalizedStyle = normalizeStyleId(style || 'apa');
  return STYLE_TEMPLATES[normalizedStyle] || normalizedStyle || 'apa';
}

/**
 * Check if style is numeric (like IEEE, Vancouver)
 */
export function isNumericStyle(style: string): boolean {
  return isNumericCslStyle(normalizeStyleId(style || 'apa'));
}

// ============================================================================
// Main Citation Functions
// ============================================================================

/**
 * Sanitize parsed CSL-JSON data on a Cite instance so that all name-variable
 * objects (author, editor, etc.) carry the `family`/`given` (or `literal`)
 * fields that citeproc-js requires. Without this, the CSL engine crashes with
 * "Cannot read properties of undefined (reading 'name')".
 */
function sanitizeCiteData(cite: InstanceType<typeof Cite>): void {
  cite.data = normalizeCslItems(cite.data);
}

/** Parse full BibTeX, including nested case-protection braces and TeX accents. */
export function getBibtexMetadata(bibtex: string): NonNullable<DecodedCitationPayload['citation_metadata']> {
  try {
    const item = normalizeCslItems(new Cite(bibtex).data)[0];
    if (!item) return {};
    return {
      id: String(item.id || ''), title: item.title,
      authors: (item.author || []).map((name: any) => name.literal || [name.given, name.family].filter(Boolean).join(' ')),
      year: item.issued?.['date-parts']?.[0]?.[0],
      doi: item.DOI, url: item.URL, journal: Array.isArray(item['container-title']) ? item['container-title'][0] : item['container-title'],
      volume: item.volume, issue: item.issue, pages: item.page,
    };
  } catch { return {}; }
}

/**
 * Format a single citation using Citation.js and the selected CSL template.
 * 
 * @param bibtex - BibTeX string
 * @param style - Citation style (apa, ieee, vancouver, etc.)
 * @param index - Citation index for numeric styles
 * @returns Formatted in-text citation and bibliography entry
 */
// Formatting one citation builds a whole CSL engine (tens of ms); the same citation in the
// same style always formats the same way, so a session formats each one once.
const formattedCache = new Map<string, FormattedCitation>();

export function formatCitation(
  bibtex: string,
  style: string = 'apa',
  index: number = 1
): FormattedCitation {
  const key = `${style}\u0000${isNumericStyle(style) ? index : ''}\u0000${bibtex}`;
  const cached = formattedCache.get(key);
  if (cached) return cached;
  const formatted = formatCitationUncached(bibtex, style, index);
  if (formattedCache.size > 4000) formattedCache.clear();
  formattedCache.set(key, formatted);
  return formatted;
}

function formatCitationUncached(bibtex: string, style: string, index: number): FormattedCitation {
  const cite = new Cite(bibtex);
  const template = getTemplateForStyle(style);
  sanitizeCiteData(cite);

  const bibliography = cite.format('bibliography', {
    format: 'html',
    template,
    lang: 'en-US',
  });
  if (!bibliography) {
    throw new Error(`CSL formatter returned no bibliography for style ${template}`);
  }

  if (isNumericStyle(style)) {
    return { inText: `[${index}]`, bibliography };
  }

  const inText = cite.format('citation', {
        format: 'text',
        template,
        lang: 'en-US'
  });
  if (!inText) {
    throw new Error(`CSL formatter returned no in-text citation for style ${template}`);
  }
  return { inText, bibliography };
}

/**
 * Format multiple citations and generate bibliography
 * 
 * @param bibtexArray - Array of BibTeX strings
 * @param style - Citation style
 * @returns Array of in-text citations and combined bibliography
 */
export function formatMultipleCitations(
  bibtexArray: string[],
  style: string = 'apa',
  options: { inText?: boolean } = {},
): { inTextCitations: string[]; bibliography: string } {
  const template = getTemplateForStyle(style);
  const sanitized = bibtexArray;

  const formatBibliographyFromCite = (cite: InstanceType<typeof Cite>) => {
    return cite.format('bibliography', {
      format: 'html',
      template,
      lang: 'en-US',
    });
  };

  const formatInTextFromCite = (cite: InstanceType<typeof Cite>) => {
    return (
      cite.format('citation', { format: 'text', template, lang: 'en-US' }) ||
      '(Citation)'
    );
  };

  try {
    const combinedBibtex = sanitized.join('\n\n');
    const cite = new Cite(combinedBibtex);
    sanitizeCiteData(cite);
    const bibliography = formatBibliographyFromCite(cite);

    const inTextCitations: string[] = [];
    if (options.inText === false) {
      // Only the reference list is wanted: skip formatting every citation again.
    } else if (isNumericStyle(style)) {
      sanitized.forEach((_, index) => {
        inTextCitations.push(`[${index + 1}]`);
      });
    } else {
      sanitized.forEach((bibtex) => {
        try {
          const c = new Cite(bibtex);
          sanitizeCiteData(c);
          inTextCitations.push(formatInTextFromCite(c));
        } catch (error) {
          throw new Error(`CSL could not format an in-text citation: ${String(error)}`);
        }
      });
    }

    return { inTextCitations, bibliography };
  } catch {
    const bibParts: string[] = [];
    const inTextCitations: string[] = [];

    sanitized.forEach((bibtex, index) => {
      try {
        const cite = new Cite(bibtex);
        sanitizeCiteData(cite);
        bibParts.push(formatBibliographyFromCite(cite));
        inTextCitations.push(
          isNumericStyle(style)
            ? `[${index + 1}]`
            : formatInTextFromCite(cite),
        );
      } catch (error) {
        throw new Error(`CSL could not format bibliography entry ${index + 1}: ${String(error)}`);
      }
    });

    if (bibParts.length === 0) {
      throw new Error('CSL returned an empty bibliography');
    }
    return { inTextCitations, bibliography: bibParts.join('\n') };
  }
}

/** A short, stable hash of a string (cyrb53), for cache keys. */
function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// The reference list of a long document takes the CSL engine about a second; it is kept per
// style and set of sources, in memory and in this browser, so reopening a document is instant.
const BIBLIOGRAPHY_CACHE_PREFIX = 'videmak-bib:';
const BIBLIOGRAPHY_CACHE_INDEX = 'videmak-bib-index';
const bibliographyMemory = new Map<string, string>();

function bibliographyKey(bibtexArray: string[], style: string) {
  return `${BIBLIOGRAPHY_CACHE_PREFIX}${style}:${bibtexArray.length}:${hashText(bibtexArray.join('\u0000'))}`;
}

/** The cached reference list for these sources and style, or null when it has to be built. */
export function peekBibliography(bibtexArray: string[], style: string): string | null {
  const key = bibliographyKey(bibtexArray, style);
  const inMemory = bibliographyMemory.get(key);
  if (inMemory !== undefined) return inMemory;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) {
      bibliographyMemory.set(key, stored);
      return stored;
    }
  } catch { /* storage blocked */ }
  return null;
}

/** The reference list (HTML) for these sources in one CSL pass, cached. */
export function formatBibliographyOnly(bibtexArray: string[], style: string): string {
  const cached = peekBibliography(bibtexArray, style);
  if (cached !== null) return cached;
  const { bibliography } = formatMultipleCitations(bibtexArray, style, { inText: false });
  const key = bibliographyKey(bibtexArray, style);
  if (bibliography && !bibliography.includes('Error generating bibliography')) {
    bibliographyMemory.set(key, bibliography);
    try {
      const index: string[] = JSON.parse(window.localStorage.getItem(BIBLIOGRAPHY_CACHE_INDEX) || '[]');
      const next = [key, ...index.filter((item) => item !== key)];
      next.slice(20).forEach((old) => window.localStorage.removeItem(old));
      window.localStorage.setItem(key, bibliography);
      window.localStorage.setItem(BIBLIOGRAPHY_CACHE_INDEX, JSON.stringify(next.slice(0, 20)));
    } catch { /* full or blocked storage: the memory copy still helps */ }
  }
  return bibliography;
}

/**
 * Extract all citations from HTML content
 * Returns array of { id, bibtex } objects
 */
export function extractCitationsFromHtml(html: string): Array<{ id: string; bibtex: string }> {
  if (typeof window === 'undefined') return [];
  
  const citations: Array<{ id: string; bibtex: string }> = [];
  const seenFingerprints = new Set<string>();
  
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const spans = doc.querySelectorAll('span[data-citation]');
    
    spans.forEach((span, index) => {
      const base64 = span.getAttribute('data-citation');
      if (!base64) return;
      
      // Use getBibtexFromBase64 which handles both JSON and BibTeX formats
      const bibtex = getBibtexFromBase64(base64);
      if (!bibtex) return;
      
      const fingerprint = getCitationFingerprint(bibtex);
      const idMatch = bibtex.match(/@\w+\{([^,]+),/);
      const id = idMatch ? idMatch[1] : fingerprint || `cite-${index}`;
      
      if (!seenFingerprints.has(fingerprint)) {
        seenFingerprints.add(fingerprint);
        citations.push({ id, bibtex });
      }
    });
  } catch (e) {
    console.error('Error extracting citations:', e);
  }
  
  return citations;
}

/**
 * Reformat all citations in HTML content to a new style
 * This is the main function for style switching
 */
function clusterAdjacentCitationDisplays(container: HTMLElement, style: string): void {
  const numericStyle = ['ieee', 'vancouver', 'ama', 'nature', 'science']
    .some(value => style.toLowerCase().includes(value));
  const spans = Array.from(container.querySelectorAll('span[data-citation]')) as HTMLElement[];
  const visited = new Set<HTMLElement>();

  for (const first of spans) {
    if (visited.has(first)) continue;
    const cluster: HTMLElement[] = [first];
    const whitespaceNodes: Text[] = [];
    let cursor: ChildNode | null = first.nextSibling;
    while (cursor) {
      if (cursor.nodeType === Node.TEXT_NODE && !(cursor.textContent || '').trim()) {
        whitespaceNodes.push(cursor as Text);
        cursor = cursor.nextSibling;
        continue;
      }
      if (cursor instanceof HTMLElement && cursor.matches('span[data-citation]')) {
        cluster.push(cursor);
        cursor = cursor.nextSibling;
        continue;
      }
      break;
    }
    if (cluster.length < 2) continue;
    cluster.forEach(span => visited.add(span));
    whitespaceNodes.forEach(node => { node.textContent = ''; });
    const displays = cluster.map(span => (span.textContent || '').trim());
    if (numericStyle && displays.every(value => /^\[?\d+\]?$/.test(value))) {
      cluster.forEach((span, index) => {
        const value = displays[index].replace(/[\[\]]/g, '');
        span.textContent = `${index === 0 ? '[' : ', '}${value}${index === cluster.length - 1 ? ']' : ''}`;
      });
      continue;
    }
    cluster.forEach((span, index) => {
      const value = displays[index].replace(/^\s*\(/, '').replace(/\)\s*$/, '').trim();
      span.textContent = `${index === 0 ? '(' : '; '}${value}${index === cluster.length - 1 ? ')' : ''}`;
    });
  }
}

export function reformatCitationsInHtml(html: string, style: string): string {
  if (typeof window === 'undefined' || !html || !html.includes('data-citation')) {
    return html;
  }
  
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const container = doc.body.firstChild as HTMLElement;
    
    // First, extract all unique citations to build index for numeric styles
    const citations = extractCitationsFromHtml(html);
    const citationIndexMap = new Map<string, number>();
    citations.forEach((cite, index) => {
      citationIndexMap.set(cite.bibtex, index + 1);
    });
    
    // Find all citation spans and reformat
    const spans = container.querySelectorAll('span[data-citation]');
    
    spans.forEach((span) => {
      const base64 = span.getAttribute('data-citation');
      if (!base64) return;
      
      // Use getBibtexFromBase64 which handles both JSON and BibTeX formats
      const bibtex = getBibtexFromBase64(base64);
      if (!bibtex) return;
      
      // Get the index for this citation (for numeric styles)
      const index = citationIndexMap.get(bibtex) || 1;
      
      // Format the citation
      const formatted = formatCitation(bibtex, style, index);
      
      // Update the span text
      span.textContent = formatted.inText;
      
      // Ensure proper attributes
      span.setAttribute('class', 'citation-token');
      span.setAttribute('contenteditable', 'false');
    });

    clusterAdjacentCitationDisplays(container, style);
    
    console.log(`Reformatted ${spans.length} citations to style: ${style}`);
    return container.innerHTML;
  } catch (e) {
    console.error('Error reformatting citations:', e);
    return html;
  }
}

/**
 * Generate bibliography HTML from document content
 */
export function generateBibliography(html: string, style: string): string {
  const citations = extractCitationsFromHtml(html);
  
  if (citations.length === 0) {
    return '<p class="text-gray-500">No citations found in the document.</p>';
  }
  
  const bibtexArray = citations.map(c => c.bibtex);
  const { bibliography } = formatMultipleCitations(bibtexArray, style);
  
  return bibliography;
}

/**
 * Create a citation span HTML string
 */
export function createCitationSpanHtml(
  bibtex: string,
  style: string = 'apa',
  index: number = 1,
  citationId?: string
): string {
  const base64 = encodeBibtexToBase64(bibtex);
  const formatted = formatCitation(bibtex, style, index);
  const id = citationId || `cite-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  return `<span class="citation-token" contenteditable="false" data-citation="${base64}" data-citation-id="${id}" data-cy="editor-preview-citation-node">${formatted.inText}</span>`;
}

// ============================================================================
// React Hook for Citation Management
// ============================================================================

/**
 * Custom hook state interface
 */
export interface CitationState {
  style: string;
  citations: CitationData[];
  bibliography: string;
}

/**
 * Initialize citation state from HTML content
 */
export function initializeCitationState(html: string, style: string): CitationState {
  const extracted = extractCitationsFromHtml(html);
  const bibtexArray = extracted.map(c => c.bibtex);
  
  const { inTextCitations, bibliography } = formatMultipleCitations(bibtexArray, style);
  
  const citations: CitationData[] = extracted.map((cite, index) => ({
    id: cite.id,
    bibtex: cite.bibtex,
    inTextCitation: inTextCitations[index] || '(Citation)',
    fullReference: '' // Will be parsed from bibliography
  }));
  
  return {
    style,
    citations,
    bibliography
  };
}

export default {
  formatCitation,
  formatMultipleCitations,
  extractCitationsFromHtml,
  reformatCitationsInHtml,
  generateBibliography,
  createCitationSpanHtml,
  decodeCitationFromBase64,
  getDecodedCitationPayload,
  getBibtexFromBase64,
  getCitationFingerprint,
  jsonCitationToBibtex,
  isBibtexFormat,
  encodeBibtexToBase64,
  getTemplateForStyle,
  isNumericStyle,
  initializeCitationState,
};
