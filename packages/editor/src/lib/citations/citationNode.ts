/**
 * Citation Node Types - Matching Competitor Format
 * 
 * This module defines the citation node format that matches the competitor's
 * BASE64-encoded JSON structure for inline citations.
 * 
 * The format stores all citation metadata directly in the HTML, making it
 * self-contained and portable.
 */

// ============================================================================
// Core Types (Matching Competitor Format)
// ============================================================================

/**
 * Contributor/Author in citation
 */
export interface CitationContributor {
  role: number;  // 0 = author, 1 = editor, 2 = translator, etc.
  name: {
    given: string;
    family: string;
  };
}

/**
 * Identifier types for papers
 */
export interface CitationIds {
  doi?: string;
  issn?: string[];
  isbn?: string[];
  openalex?: string;
  pmid?: string;
  pmcid?: string;
  arxiv?: string;
  exa?: string;  // External URL (e.g., arXiv PDF)
}

/**
 * Container (journal/book) information
 */
export interface ContainerInfo {
  title?: string;
  authors?: CitationContributor[];
}

/**
 * Location within container (pages, volume, etc.)
 */
export interface ContainerLocator {
  pageRange?: {
    firstPage?: number | string;
    lastPage?: number | string;
  };
  volume?: string;
  issue?: string;
}

/**
 * Citation statistics
 */
export interface CitationTally {
  referencedWorksCount?: number;
  citedByCount?: number;
}

/**
 * Publisher information
 */
export interface PublisherInfo {
  name?: string;
  location?: string;
}

/**
 * Work subtype specifics
 */
export interface WorkSubtype {
  oneofKind?: string;
  articleType?: number;  // 1 = journal article, 2 = conference, etc.
}

/**
 * The main work/paper metadata structure
 * Matches competitor's "work" object format
 */
export interface CitationWork {
  type: number;  // 8 = article-journal, 2 = book, etc.
  subtype?: WorkSubtype;
  contributors: CitationContributor[];
  ids: CitationIds;
  title: string;
  abstract?: string;
  url?: string;
  resourceUrl?: string;  // Direct PDF URL
  issuedDate?: string;  // YYYY-MM-DD format
  accessedDate?: string;  // YYYY-MM format
  containerInfo?: ContainerInfo;
  containerLocator?: ContainerLocator;
  publisherInfo?: PublisherInfo;
  tally?: CitationTally;
  temp?: string;
  quote?: string;  // The quote/excerpt used
  origin?: number;  // Source origin (1 = user library, 5 = AI-retrieved, etc.)
  score?: number;  // Relevance score
}

/**
 * Full citation node payload (what gets BASE64 encoded)
 * This is an array with a single object matching competitor format
 */
export interface CitationNodePayload {
  origin: number;
  work: CitationWork;
  quote?: string;
  externalCacheId?: string;
}

// ============================================================================
// BibTeX Types
// ============================================================================

/**
 * BibTeX entry parsed from string
 */
export interface BibTeXEntry {
  citation_node: string;  // Unique ID like PAPER_43212
  type: string;  // article, book, inproceedings, etc.
  key: string;
  title?: string;
  author?: string;
  year?: string;
  journal?: string;
  booktitle?: string;
  volume?: string;
  number?: string;
  pages?: string;
  publisher?: string;
  doi?: string;
  url?: string;
  abstract?: string;
  issn?: string;
  isbn?: string;
  keywords?: string;
  arxivId?: string;
  pmid?: string;
}

// ============================================================================
// Type Mappings
// ============================================================================

/**
 * CSL type numbers
 */
export const CSL_TYPES: Record<string, number> = {
  'article-journal': 8,
  'article': 8,
  'book': 2,
  'chapter': 3,
  'thesis': 4,
  'report': 5,
  'paper-conference': 6,
  'dataset': 7,
  'webpage': 9,
  'post-weblog': 10,
};

/**
 * Contributor role numbers
 */
export const CONTRIBUTOR_ROLES = {
  author: 0,
  editor: 1,
  translator: 2,
  contributor: 3,
};

// ============================================================================
// Encoding/Decoding Functions
// ============================================================================

/**
 * Encode citation payload to BASE64
 */
export function encodeCitationNode(payload: CitationNodePayload[]): string {
  const jsonStr = JSON.stringify(payload);
  
  if (typeof window !== 'undefined') {
    // Browser environment - handle Unicode
    return btoa(unescape(encodeURIComponent(jsonStr)));
  } else {
    // Node.js environment
    return Buffer.from(jsonStr, 'utf-8').toString('base64');
  }
}

/**
 * Decode BASE64 citation to payload
 */
export function decodeCitationNode(base64Str: string): CitationNodePayload[] | null {
  try {
    let jsonStr: string;
    
    if (typeof window !== 'undefined') {
      jsonStr = decodeURIComponent(escape(atob(base64Str)));
    } else {
      jsonStr = Buffer.from(base64Str, 'base64').toString('utf-8');
    }
    
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error('Error decoding citation node:', error);
    return null;
  }
}

// ============================================================================
// Conversion Functions
// ============================================================================

/**
 * Convert BibTeX entry to CitationWork
 */
export function bibtexToWork(bibtex: BibTeXEntry): CitationWork {
  // Parse authors
  const contributors: CitationContributor[] = [];
  if (bibtex.author) {
    const authorStrings = bibtex.author.split(' and ').map(a => a.trim());
    for (const authorStr of authorStrings) {
      // Handle "Last, First" or "First Last" format
      if (authorStr.includes(',')) {
        const [family, given] = authorStr.split(',', 2).map(s => s.trim());
        contributors.push({ role: 0, name: { family, given: given || '' } });
      } else {
        const parts = authorStr.split(' ');
        const family = parts.pop() || '';
        const given = parts.join(' ');
        contributors.push({ role: 0, name: { family, given } });
      }
    }
  }
  
  // Build IDs
  const ids: CitationIds = {};
  if (bibtex.doi) ids.doi = bibtex.doi;
  if (bibtex.issn) ids.issn = [bibtex.issn];
  if (bibtex.isbn) ids.isbn = [bibtex.isbn];
  if (bibtex.arxivId) ids.arxiv = bibtex.arxivId;
  if (bibtex.pmid) ids.pmid = bibtex.pmid;
  if (bibtex.url) ids.exa = bibtex.url;
  
  // Determine type
  let type = CSL_TYPES['article-journal'];
  if (bibtex.type === 'book') type = CSL_TYPES['book'];
  if (bibtex.type === 'inproceedings' || bibtex.type === 'conference') type = CSL_TYPES['paper-conference'];
  if (bibtex.type === 'thesis' || bibtex.type === 'phdthesis' || bibtex.type === 'mastersthesis') type = CSL_TYPES['thesis'];
  
  return {
    type,
    contributors: contributors.length > 0 ? contributors : [{ role: 0, name: { family: 'Unknown', given: '' } }],
    ids,
    title: bibtex.title || 'Untitled',
    abstract: bibtex.abstract,
    url: bibtex.url,
    issuedDate: bibtex.year ? `${bibtex.year}-01-01` : undefined,
    containerInfo: bibtex.journal ? { title: bibtex.journal } : undefined,
    containerLocator: {
      volume: bibtex.volume,
      issue: bibtex.number,
      pageRange: bibtex.pages ? parsePageRange(bibtex.pages) : undefined,
    },
  };
}

/**
 * Parse page range string
 */
function parsePageRange(pages: string): { firstPage: string; lastPage?: string } | undefined {
  if (!pages) return undefined;
  
  if (pages.includes('-')) {
    const [first, last] = pages.split('-').map(p => p.trim());
    return { firstPage: first, lastPage: last };
  }
  return { firstPage: pages };
}

/**
 * Create full citation node payload from BibTeX
 */
export function createCitationPayload(bibtex: BibTeXEntry, quote?: string): CitationNodePayload[] {
  const work = bibtexToWork(bibtex);
  if (quote) work.quote = quote;
  
  return [{
    origin: 5,  // AI-retrieved
    work,
    quote,
    externalCacheId: bibtex.citation_node,
  }];
}

// ============================================================================
// HTML Generation
// ============================================================================

/**
 * Create citation HTML span with embedded BASE64 metadata
 * This is the final format that goes into the editor
 */
export function createCitationHtml(
  payload: CitationNodePayload[],
  displayText: string
): string {
  const base64 = encodeCitationNode(payload);
  const work = payload[0]?.work;
  const entryId = work?.ids?.doi || payload[0]?.externalCacheId || 'unknown';
  
  return `<span class="citation-token" contenteditable="false" data-citation="${base64}" data-cy="editor-preview-citation-node">${displayText}</span>`;
}

/**
 * Format in-text citation from work metadata
 * Returns something like "(Smith et al., 2023)" for APA
 */
export function formatInTextCitation(work: CitationWork, style: string = 'apa'): string {
  const contributors = work.contributors || [];
  const year = work.issuedDate ? work.issuedDate.split('-')[0] : 'n.d.';
  
  // Get first author's family name
  const firstAuthor = contributors[0]?.name?.family || 'Unknown';
  
  // Numeric styles
  const numericStyles = ['ieee', 'vancouver', 'ama', 'nature', 'science'];
  if (numericStyles.some(s => style.toLowerCase().includes(s))) {
    return '[#]';  // Placeholder - actual number assigned during formatting
  }
  
  // Author-date styles
  if (contributors.length === 1) {
    return `(${firstAuthor}, ${year})`;
  } else if (contributors.length === 2) {
    const secondAuthor = contributors[1]?.name?.family || '';
    return `(${firstAuthor} & ${secondAuthor}, ${year})`;
  } else {
    return `(${firstAuthor} et al., ${year})`;
  }
}

// ============================================================================
// Extraction Functions
// ============================================================================

/**
 * Extract all citation payloads from HTML content
 */
export function extractCitationsFromHtml(html: string): CitationNodePayload[][] {
  const pattern = /data-citation="([^"]+)"/g;
  const citations: CitationNodePayload[][] = [];
  const seenIds = new Set<string>();
  
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const payload = decodeCitationNode(match[1]);
    if (payload && payload.length > 0) {
      const id = payload[0]?.externalCacheId || payload[0]?.work?.ids?.doi;
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        citations.push(payload);
      }
    }
  }
  
  return citations;
}

/**
 * Generate unique citation node ID
 */
export function generateCitationNodeId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `PAPER_${timestamp}${random}`.toUpperCase();
}

// ============================================================================
// Export
// ============================================================================

export default {
  encodeCitationNode,
  decodeCitationNode,
  bibtexToWork,
  createCitationPayload,
  createCitationHtml,
  formatInTextCitation,
  extractCitationsFromHtml,
  generateCitationNodeId,
  CSL_TYPES,
  CONTRIBUTOR_ROLES,
};

