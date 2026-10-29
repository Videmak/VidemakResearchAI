/**
 * Citation Formatter - Client-side formatting using Citation-JS
 * 
 * Formats citation metadata to in-text citations and bibliography entries
 * using the embedded metadata. No server calls needed for style switching!
 * 
 * Supports 10,000+ CSL styles from the official repository.
 */

import { Cite, plugins } from '@citation-js/core';
import '@citation-js/plugin-csl';
import '@citation-js/plugin-bibtex';
import type { CitationMetadata, CitationStyle } from './types';
import { 
  loadCslStyle, 
  normalizeStyleId, 
} from './cslStyles';
import { normalizeCslItem } from './cslDataNormalizer';
import { decodeCitationFromBase64, isBibtexFormat } from './citationService';
import { decodeCitation } from './encoder';

// ============================================================================
// Style Formatting Functions
// ============================================================================

/**
 * Normalize style name to official CSL repository name
 */
export function normalizeStyleName(style: string): string {
  return normalizeStyleId(style);
}

/**
 * Load CSL style (re-export from cslStyles)
 */
export { loadCslStyle } from './cslStyles';

async function ensureCslTemplate(style: CitationStyle): Promise<string> {
  const normalized = normalizeStyleId(style);
  const loaded = await loadCslStyle(normalized);
  const config = (plugins as any).config.get('@csl');
  if (!loaded || !config?.templates?.has?.(normalized)) {
    throw new Error(`CSL style '${normalized}' is not available`);
  }
  return normalized;
}

function decodeEmbeddedCitation(encoded: string): CitationMetadata | null {
  const decoded = decodeCitationFromBase64(encoded);
  if (!decoded) return null;

  try {
    let bibtex: string | null = null;
    if (isBibtexFormat(decoded)) {
      bibtex = decoded;
    } else {
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed.bibtex === 'string' && isBibtexFormat(parsed.bibtex)) {
        bibtex = parsed.bibtex;
      }
    }

    if (bibtex) {
      const cite = new Cite(bibtex);
      const item = Array.isArray(cite.data) ? cite.data[0] : null;
      return item ? normalizeCslItem(item) as CitationMetadata : null;
    }
  } catch (error) {
    console.error('Could not parse embedded BibTeX citation:', error);
    return null;
  }

  const legacy = decodeCitation(encoded);
  return legacy ? normalizeCslItem(legacy as any) as CitationMetadata : null;
}

function extractEmbeddedCitations(html: string): CitationMetadata[] {
  const pattern = /data-citation="([^"]+)"/g;
  const citations: CitationMetadata[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const metadata = decodeEmbeddedCitation(match[1]);
    if (!metadata) continue;
    const identity = metadata.DOI || metadata.id;
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    citations.push(metadata);
  }
  return citations;
}

/**
 * Format in-text citation from metadata
 */
export async function formatInText(
  metadata: CitationMetadata,
  style: CitationStyle
): Promise<string> {
  const normalized = await ensureCslTemplate(style);
  const citeData = metadataToCiteJs(metadata);
  const cite = new Cite(citeData);
  const result = cite.format('citation', {
    format: 'text',
    template: normalized,
    lang: 'en-US',
  });
  if (!result) {
    throw new Error(`CSL returned no in-text citation for style ${normalized}`);
  }
  return result;
}

/**
 * Format bibliography entry from metadata
 */
export async function formatBibliography(
  metadata: CitationMetadata,
  style: CitationStyle
): Promise<string> {
  const normalized = await ensureCslTemplate(style);
  const citeData = metadataToCiteJs(metadata);
  const cite = new Cite(citeData);
  const result = cite.format('bibliography', {
    format: 'html',
    template: normalized,
    lang: 'en-US',
  });
  if (!result) {
    throw new Error(`CSL returned no bibliography for style ${normalized}`);
  }
  return result;
}

/**
 * Format multiple citations for bibliography
 */
export async function formatBibliographyList(
  citations: CitationMetadata[],
  style: CitationStyle
): Promise<string[]> {
  const results: string[] = [];
  
  for (const citation of citations) {
    const formatted = await formatBibliography(citation, style);
    results.push(formatted);
  }
  
  return results;
}

/**
 * Convert CitationMetadata to Citation-JS input format
 */
function metadataToCiteJs(metadata: CitationMetadata): object {
  return normalizeCslItem({
    id: metadata.id,
    type: metadata.type || 'article-journal',
    title: metadata.title,
    author: metadata.author,
    issued: metadata.issued,
    DOI: metadata.DOI,
    URL: metadata.URL,
    'container-title': metadata['container-title'],
    volume: metadata.volume,
    issue: metadata.issue,
    page: metadata.page,
    publisher: metadata.publisher,
    abstract: metadata.abstract,
    ISSN: metadata.ISSN,
    ISBN: metadata.ISBN,
  });
}

/**
 * Reformat all citations in HTML content to a new style
 * This is the main function for style switching
 */
export async function reformatCitationsInHtml(
  html: string,
  newStyle: CitationStyle
): Promise<string> {
  const normalized = await ensureCslTemplate(newStyle);
  
  // Pattern to match citation spans with their content
  // Using [\s\S] instead of . with s flag for ES2017 compatibility
  const spanPattern = /<span[^>]*class="[^"]*citation-inline[^"]*"[^>]*data-citation="([^"]+)"[^>]*>[\s\S]*?<\/span>/g;
  
  let result = html;
  
  // Collect all matches first (using exec loop for compatibility)
  const matches: Array<{ fullMatch: string; encoded: string }> = [];
  let match: RegExpExecArray | null;
  
  while ((match = spanPattern.exec(html)) !== null) {
    matches.push({ fullMatch: match[0], encoded: match[1] });
  }
  
  for (const { fullMatch, encoded } of matches) {
    
    // Decode metadata
    const metadata = decodeEmbeddedCitation(encoded);
    
    if (metadata) {
      // Format with new style
      const newInText = await formatInText(metadata, newStyle);
      
      // Create new span with same encoded data but new text
      const entryId = metadata.DOI || metadata.id;
      const newSpan = `<span class="citation-inline" data-citation="${encoded}" data-csl-entry-id="${entryId}" contenteditable="false">${newInText}</span>`;
      
      result = result.replace(fullMatch, newSpan);
    }
  }
  
  return result;
}

/**
 * Get sorted references from HTML for bibliography display
 */
export async function getReferencesFromHtml(
  html: string,
  style: CitationStyle
): Promise<Array<{ id: string; html: string; metadata: CitationMetadata }>> {
  const citations = extractEmbeddedCitations(html);
  
  // Sort by author last name
  citations.sort((a, b) => {
    const aName = a.author?.[0]?.family || 'ZZZ';
    const bName = b.author?.[0]?.family || 'ZZZ';
    return aName.localeCompare(bName);
  });
  
  const results: Array<{ id: string; html: string; metadata: CitationMetadata }> = [];
  
  for (const metadata of citations) {
    const formatted = await formatBibliography(metadata, style);
    results.push({
      id: metadata.DOI || metadata.id,
      html: formatted,
      metadata,
    });
  }
  
  return results;
}
