/**
 * Citation Renumbering Service
 * 
 * Handles global renumbering of citations across the entire document.
 * This ensures that numeric styles (IEEE, Vancouver) have continuous numbering
 * and author-date styles have consistent formatting throughout.
 * 
 * Key Features:
 * - Extracts all citations in order of first appearance
 * - Assigns global sequential numbers for numeric styles
 * - Ensures same citation uses same number/format throughout
 * - Handles duplicate citations (same source in multiple sections)
 * - Updates both in-text citations and bibliography numbering
 */

import { 
  getBibtexFromBase64, 
  formatCitation,
  isNumericStyle,
  getDecodedCitationPayload,
  getBibtexMetadata,
  getEvidencePageLabel,
  DecodedCitationPayload,
} from './citationService';
import { formatCitationBatch } from './citationFormatApi';

// ============================================================================
// Types
// ============================================================================

export interface CitationOccurrence {
  /** Unique identifier for this citation (from BibTeX key) */
  id: string;
  /** The BibTeX content */
  bibtex: string;
  /** Base64 encoded citation data */
  base64: string;
  /** Global citation number (1-based, for numeric styles) */
  globalNumber: number;
  /** Formatted in-text citation string */
  inTextFormatted: string;
  /** CSL-formatted bibliography returned by the authoritative service */
  bibliographyFormatted: string;
  /** Combined CSL run already supplied the numeric bibliography marker. */
  bibliographyContainsGlobalNumber?: boolean;
  evidencePages: number[];
  printedPageLabels: string[];
}

export interface RenumberingResult {
  /** The HTML with all citations renumbered */
  html: string;
  /** Ordered list of unique citations */
  citations: CitationOccurrence[];
  /** Number of citations processed */
  totalCitations: number;
  /** Number of unique citations */
  uniqueCitations: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique key for a citation based on its BibTeX content
 * This helps identify duplicate citations (same source used multiple times)
 */
function getCitationKey(bibtex: string): string {
  // Try to extract the BibTeX entry key first
  const keyMatch = bibtex.match(/@\w+\{([^,]+),/);
  if (keyMatch) {
    return keyMatch[1].trim().toLowerCase();
  }
  
  // Fallback: create a hash from author + title + year
  const authorMatch = bibtex.match(/author\s*=\s*\{([^}]+)\}/i);
  const titleMatch = bibtex.match(/title\s*=\s*\{([^}]+)\}/i);
  const yearMatch = bibtex.match(/year\s*=\s*\{([^}]+)\}/i);
  
  const author = authorMatch ? authorMatch[1].toLowerCase().slice(0, 30) : '';
  const title = titleMatch ? titleMatch[1].toLowerCase().slice(0, 50) : '';
  const year = yearMatch ? yearMatch[1] : '';
  
  return `${author}-${year}-${title}`.replace(/[^a-z0-9-]/g, '');
}

/**
 * Extract all citation spans from HTML in order of appearance
 * Returns both the span info and position for proper ordering
 */
function extractCitationSpansInOrder(html: string): Array<{
  fullMatch: string;
  base64: string;
  bibtex: string;
  key: string;
  position: number;
  payload: DecodedCitationPayload | null;
  displayText: string;
}> {
  const results: Array<{
    fullMatch: string;
    base64: string;
    bibtex: string;
    key: string;
    position: number;
    payload: DecodedCitationPayload | null;
    displayText: string;
  }> = [];
  
  // Match citation spans with data-citation attribute
  // Handle various class names: citation-token, citation-inline, etc.
  const pattern = /<span[^>]*(?:class="[^"]*citation[^"]*")[^>]*data-citation="([^"]+)"[^>]*>[\s\S]*?<\/span>/gi;
  
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const base64 = match[1];
    const bibtex = getBibtexFromBase64(base64);
    
    if (bibtex) {
      results.push({
        fullMatch: match[0],
        base64,
        bibtex,
        key: getCitationKey(bibtex),
        position: match.index,
        payload: getDecodedCitationPayload(base64),
        displayText: match[0].replace(/<[^>]+>/g, '').trim(),
      });
    }
  }
  
  // Also check for spans where data-citation comes before class
  const altPattern = /<span[^>]*data-citation="([^"]+)"[^>]*(?:class="[^"]*citation[^"]*")[^>]*>[\s\S]*?<\/span>/gi;
  
  while ((match = altPattern.exec(html)) !== null) {
    const base64 = match[1];
    // Skip if already found
    if (results.some(r => r.base64 === base64 && r.position === match!.index)) {
      continue;
    }
    
    const bibtex = getBibtexFromBase64(base64);
    
    if (bibtex) {
      results.push({
        fullMatch: match[0],
        base64,
        bibtex,
        key: getCitationKey(bibtex),
        position: match.index,
        payload: getDecodedCitationPayload(base64),
        displayText: match[0].replace(/<[^>]+>/g, '').trim(),
      });
    }
  }
  
  // Sort by position in document
  results.sort((a, b) => a.position - b.position);
  
  return results;
}

function escapeReferenceHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fallbackCitationFormatting(
  span: ReturnType<typeof extractCitationSpansInOrder>[number],
  style: string,
  index: number,
): { inText: string; bibliography: string } {
  const payload = span.payload || { bibtex: span.bibtex };
  const metadata = { ...payload.citation_metadata, ...getBibtexMetadata(span.bibtex) };
  const numeric = isNumericStyle(style);
  const author = String(metadata.authors?.join(', ') || payload.author || 'Unknown').trim() || 'Unknown';
  const year = String(payload.year || metadata.year || 'n.d.').trim() || 'n.d.';
  const title = String(metadata.title || 'Untitled source').trim();
  const doi = String(metadata.doi || '').trim();
  const embeddedBibliography = typeof payload.bibliography === 'string'
    ? payload.bibliography.trim()
    : '';
  const inText = numeric
    ? `[${index}]`
    : span.displayText || `(${author}, ${year})`;
  const bibliography = embeddedBibliography || [
    escapeReferenceHtml(author),
    ` (${escapeReferenceHtml(year)}). `,
    `<i>${escapeReferenceHtml(title)}</i>.`,
    metadata.journal ? ` ${escapeReferenceHtml(metadata.journal)}.` : '',
    metadata.volume ? ` ${escapeReferenceHtml(metadata.volume)}${metadata.issue ? `(${escapeReferenceHtml(metadata.issue)})` : ''}` : '',
    metadata.pages ? `, ${escapeReferenceHtml(metadata.pages)}.` : '',
    doi ? ` <a href="https://doi.org/${encodeURIComponent(doi)}">https://doi.org/${escapeReferenceHtml(doi)}</a>` : '',
  ].join('');
  return { inText, bibliography };
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Renumber all citations in HTML content for the full document
 * 
 * This is the main function that should be called when generating the full document.
 * It ensures continuous citation numbering across all sections.
 * 
 * @param html - The full document HTML content
 * @param style - Citation style (e.g., 'apa', 'ieee', 'vancouver')
 * @returns RenumberingResult with renumbered HTML and citation info
 */
export function renumberCitationsForFullDocument(
  html: string,
  style: string = 'apa'
): RenumberingResult {
  if (!html || !html.includes('data-citation')) {
    return { html, citations: [], totalCitations: 0, uniqueCitations: 0 };
  }
  const spans = extractCitationSpansInOrder(html);
  if (spans.length === 0) {
    return { html, citations: [], totalCitations: 0, uniqueCitations: 0 };
  }

  const citationMap = new Map<string, CitationOccurrence>();
  let globalNumber = 1;
  for (const span of spans) {
    if (!citationMap.has(span.key)) {
      let formatted: { inText: string; bibliography: string };
      try {
        formatted = formatCitation(span.bibtex, style, globalNumber);
      } catch (error) {
        // Agent chat recompiles while tab HTML is still streaming. CSL must
        // never be allowed to unmount the workspace because one provider
        // returned a malformed style/item combination. Preserve the embedded
        // display and provenance, then let the authoritative export formatter
        // produce the final styled bibliography.
        console.warn('[CitationRenumbering] Preserving citation after CSL rejection:', error);
        formatted = fallbackCitationFormatting(span, style, globalNumber);
      }
      citationMap.set(span.key, {
        id: span.key,
        bibtex: span.bibtex,
        base64: span.base64,
        globalNumber,
        inTextFormatted: formatted.inText,
        bibliographyFormatted: formatted.bibliography,
        bibliographyContainsGlobalNumber: false,
        evidencePages: Array.from(new Set(span.payload?.evidence_pages || [])),
        printedPageLabels: Array.from(new Set(span.payload?.printed_page_labels || [])),
      });
      globalNumber++;
    } else {
      const existing = citationMap.get(span.key)!;
      existing.evidencePages = Array.from(new Set([
        ...existing.evidencePages,
        ...(span.payload?.evidence_pages || []),
      ])).sort((a, b) => a - b);
      existing.printedPageLabels = Array.from(new Set([
        ...existing.printedPageLabels,
        ...(span.payload?.printed_page_labels || []),
      ]));
    }
  }

  let renumberedHtml = html;
  for (const span of [...spans].sort((a, b) => b.position - a.position)) {
    const citation = citationMap.get(span.key);
    if (!citation) continue;
    const replacement = buildCitationSpan(span.base64, citation.inTextFormatted, citation.id);
    renumberedHtml = renumberedHtml.substring(0, span.position)
      + replacement
      + renumberedHtml.substring(span.position + span.fullMatch.length);
  }
  const citations = Array.from(citationMap.values()).sort((a, b) => a.globalNumber - b.globalNumber);
  return {
    html: renumberedHtml,
    citations,
    totalCitations: spans.length,
    uniqueCitations: citations.length,
  };
}

/**
 * Research Agent variant. Citation.js/citeproc is intentionally not created
 * in the browser; the authoritative service formats all unique entries in one
 * bounded request and returns both in-text and bibliography output.
 */
export async function renumberCitationsForFullDocumentAuthoritative(
  html: string,
  style: string = 'apa'
): Promise<RenumberingResult> {
  if (!html || !html.includes('data-citation')) {
    return {
      html,
      citations: [],
      totalCitations: 0,
      uniqueCitations: 0
    };
  }
  
  // Extract all citation spans in order of appearance
  const spans = extractCitationSpansInOrder(html);
  
  if (spans.length === 0) {
    return {
      html,
      citations: [],
      totalCitations: 0,
      uniqueCitations: 0
    };
  }
  
  // Build map of unique citations (first occurrence determines number)
  const citationMap = new Map<string, CitationOccurrence>();
  let globalNumber = 1;
  
  for (const span of spans) {
    if (!citationMap.has(span.key)) {
      // First occurrence of this citation - assign global number
      citationMap.set(span.key, {
        id: span.key,
        bibtex: span.bibtex,
        base64: span.base64,
        globalNumber: globalNumber,
        inTextFormatted: '',
        bibliographyFormatted: '',
        bibliographyContainsGlobalNumber: true,
        evidencePages: Array.from(new Set(span.payload?.evidence_pages || [])),
        printedPageLabels: Array.from(new Set(span.payload?.printed_page_labels || [])),
      });
      
      globalNumber++;
    } else {
      const existing = citationMap.get(span.key)!;
      existing.evidencePages = Array.from(new Set([
        ...existing.evidencePages,
        ...(span.payload?.evidence_pages || []),
      ])).sort((a, b) => a - b);
      existing.printedPageLabels = Array.from(new Set([
        ...existing.printedPageLabels,
        ...(span.payload?.printed_page_labels || []),
      ]));
    }
  }

  const orderedCitations = Array.from(citationMap.values())
    .sort((a, b) => a.globalNumber - b.globalNumber);
  const formatted = await formatCitationBatch(
    orderedCitations.map(citation => ({
      id: citation.id,
      bibtex: citation.bibtex,
      index: citation.globalNumber,
    })),
    style,
  );
  formatted.forEach((result, index) => {
    const citation = orderedCitations[index];
    if (!citation || !result.inText || !result.bibliography) {
      throw new Error(result.error || `Citation ${index + 1} returned incomplete CSL output`);
    }
    citation.inTextFormatted = result.inText;
    citation.bibliographyFormatted = result.bibliography;
  });
  
  // Now replace all citation spans with correctly numbered versions
  let renumberedHtml = html;
  // Process each span (work backwards to preserve positions)
  const sortedSpans = [...spans].sort((a, b) => b.position - a.position);
  
  for (const span of sortedSpans) {
    const citation = citationMap.get(span.key);
    if (!citation) continue;
    
    // Build the replacement span with correct formatting
    const newSpan = buildCitationSpan(
      span.base64,
      citation.inTextFormatted,
      citation.id
    );
    
    // Replace this specific occurrence
    renumberedHtml = 
      renumberedHtml.substring(0, span.position) +
      newSpan +
      renumberedHtml.substring(span.position + span.fullMatch.length);
  }
  
  console.log(`[CitationRenumbering] Processed ${spans.length} citations, ${orderedCitations.length} unique`);
  
  return {
    html: renumberedHtml,
    citations: orderedCitations,
    totalCitations: spans.length,
    uniqueCitations: orderedCitations.length
  };
}

/**
 * Build a citation span HTML element
 */
function buildCitationSpan(base64: string, inTextFormatted: string, id: string): string {
  return `<span class="citation-token" contenteditable="false" data-citation="${base64}" data-citation-id="${id}" data-cy="editor-preview-citation-node">${inTextFormatted}</span>`;
}

/**
 * Generate bibliography HTML with correct numbering
 * 
 * @param citations - Array of CitationOccurrence from renumberCitationsForFullDocument
 * @param style - Citation style
 * @returns HTML string for the references section
 */
export function generateNumberedBibliography(
  citations: CitationOccurrence[],
  style: string = 'apa'
): string {
  if (!citations || citations.length === 0) {
    return '';
  }
  
  const isNumeric = isNumericStyle(style);
  const entries = citations.map((citation) => {
    if (!citation.bibliographyFormatted) {
      throw new Error(`Citation ${citation.globalNumber} has no authoritative bibliography output`);
    }
    const number = isNumeric && !citation.bibliographyContainsGlobalNumber
      ? `[${citation.globalNumber}] `
      : '';
    const payload: DecodedCitationPayload = {
      bibtex: citation.bibtex,
      evidence_pages: citation.evidencePages,
      printed_page_labels: citation.printedPageLabels,
    };
    const pageLabel = getEvidencePageLabel(payload);
    const evidence = pageLabel
      ? `<div class="reference-evidence-pages"><small>Evidence used: pp. ${pageLabel}</small></div>`
      : '';
    return `<div class="reference-item">${number}${citation.bibliographyFormatted}${evidence}</div>`;
  }).join('\n');

  return `<div class="references-list${isNumeric ? ' numbered-references' : ''}">${entries}</div>`;
}

/**
 * Process full document with citation renumbering
 * 
 * This is a convenience function that combines renumbering and bibliography generation.
 * Call this when you need to process the complete document with proper citations.
 * 
 * @param html - The full document HTML
 * @param style - Citation style
 * @returns Object with renumbered HTML and references HTML
 */
export function processDocumentCitations(
  html: string,
  style: string = 'apa'
): { documentHtml: string; referencesHtml: string; citationCount: number } {
  const result = renumberCitationsForFullDocument(html, style);
  
  if (result.uniqueCitations === 0) {
    return {
      documentHtml: html,
      referencesHtml: '',
      citationCount: 0
    };
  }
  
  const referencesHtml = generateNumberedBibliography(result.citations, style);
  
  return {
    documentHtml: result.html,
    referencesHtml,
    citationCount: result.uniqueCitations
  };
}

/**
 * Check if HTML content has citations that need renumbering
 */
export function hasCitations(html: string): boolean {
  return html?.includes('data-citation') || false;
}

export default {
  renumberCitationsForFullDocument,
  renumberCitationsForFullDocumentAuthoritative,
  generateNumberedBibliography,
  processDocumentCitations,
  hasCitations
};
