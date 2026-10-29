/**
 * Citation Encoder/Decoder - Self-Contained Citation System
 * 
 * Handles base64 encoding/decoding of citation metadata.
 * This allows citation data to be embedded directly in HTML.
 */

import type { CitationMetadata, SourceData, CitationAuthor, CitationDate } from './types';

/**
 * Encode citation metadata to base64 string
 */
export function encodeCitation(metadata: CitationMetadata): string {
  const jsonStr = JSON.stringify(metadata);
  
  if (typeof window !== 'undefined') {
    // Browser environment
    return btoa(unescape(encodeURIComponent(jsonStr)));
  } else {
    // Node.js environment
    return Buffer.from(jsonStr, 'utf-8').toString('base64');
  }
}

/**
 * Decode base64 string to citation metadata
 * Handles both direct CSL-JSON and competitor format [{work: {...}}]
 */
export function decodeCitation(base64Str: string): CitationMetadata | null {
  try {
    let jsonStr: string;
    
    if (typeof window !== 'undefined') {
      // Browser environment
      jsonStr = decodeURIComponent(escape(atob(base64Str)));
    } else {
      // Node.js environment
      jsonStr = Buffer.from(base64Str, 'base64').toString('utf-8');
    }
    
    const parsed = JSON.parse(jsonStr);
    
    // Handle competitor format: [{work: {...}}]
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.work) {
      return parsed[0].work as CitationMetadata;
    }
    
    // Handle array of CSL-JSON: [{...}]
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed[0] as CitationMetadata;
    }
    
    // Direct CSL-JSON format
    return parsed as CitationMetadata;
  } catch (error) {
    console.error('Error decoding citation:', error);
    return null;
  }
}

/**
 * Convert source data (from APIs) to standard CitationMetadata format
 */
export function sourceToMetadata(source: SourceData): CitationMetadata {
  return {
    id: source.id || source.doi || generateId(source),
    type: 'article-journal', // Default type
    title: source.title || 'Untitled',
    author: parseAuthors(source),
    issued: parseDate(source),
    
    // Optional fields
    ...(source.doi && { DOI: source.doi }),
    ...(source.url && { URL: source.url }),
    ...((source.journal || source['container-title']) && { 
      'container-title': source.journal || source['container-title'] 
    }),
    ...(source.volume && { volume: String(source.volume) }),
    ...(source.issue && { issue: String(source.issue) }),
    ...(source.pages && { page: source.pages }),
    ...(source.publisher && { publisher: source.publisher }),
    ...(source.abstract && { abstract: source.abstract }),
    ...(source.issn && { 
      ISSN: Array.isArray(source.issn) ? source.issn : [source.issn] 
    }),
    ...(source.isbn && { 
      ISBN: Array.isArray(source.isbn) ? source.isbn : [source.isbn] 
    }),
  };
}

/**
 * Parse authors from various formats
 */
function parseAuthors(source: SourceData): CitationAuthor[] {
  const authors = source.authors || source.author || source.contributors || [];
  
  if (!authors || authors.length === 0) {
    return [{ family: 'Unknown' }];
  }
  
  const result: CitationAuthor[] = [];
  
  for (const author of authors) {
    if (typeof author === 'string') {
      // Simple string format
      if (author.includes(',')) {
        const [family, given] = author.split(',', 2);
        result.push({ family: family.trim(), given: given?.trim() });
      } else {
        const parts = author.trim().split(' ');
        if (parts.length >= 2) {
          result.push({ 
            given: parts.slice(0, -1).join(' '), 
            family: parts[parts.length - 1] 
          });
        } else {
          result.push({ family: author });
        }
      }
    } else if (typeof author === 'object') {
      // Object format
      if ('family' in author || 'given' in author) {
        result.push({ 
          family: author.family || '', 
          given: author.given || '' 
        });
      } else if ('name' in author) {
        const name = author.name;
        if (typeof name === 'object' && name) {
          result.push({ 
            family: name.family || '', 
            given: name.given || '' 
          });
        } else if (typeof name === 'string') {
          if (name.includes(',')) {
            const [family, given] = name.split(',', 2);
            result.push({ family: family.trim(), given: given?.trim() });
          } else {
            const parts = name.trim().split(' ');
            if (parts.length >= 2) {
              result.push({ 
                given: parts.slice(0, -1).join(' '), 
                family: parts[parts.length - 1] 
              });
            } else {
              result.push({ family: name });
            }
          }
        }
      } else if ('lastName' in author || 'firstName' in author) {
        result.push({ 
          family: author.lastName || '', 
          given: author.firstName || '' 
        });
      }
    }
  }
  
  return result.length > 0 ? result : [{ family: 'Unknown' }];
}

/**
 * Parse date from various formats
 */
function parseDate(source: SourceData): CitationDate {
  const year = source.year || source.publication_year;
  const dateStr = source.issuedDate || source.published_date || source.date;
  
  if (year) {
    return { 'date-parts': [[Number(year)]] };
  }
  
  if (dateStr) {
    try {
      if (String(dateStr).includes('-')) {
        const parts = String(dateStr).split('-');
        const dateParts = parts
          .slice(0, 3)
          .map(p => parseInt(p, 10))
          .filter(n => !isNaN(n));
        if (dateParts.length > 0) {
          return { 'date-parts': [dateParts] };
        }
      } else {
        const parsed = parseInt(String(dateStr), 10);
        if (!isNaN(parsed)) {
          return { 'date-parts': [[parsed]] };
        }
      }
    } catch {
      // Fall through to default
    }
  }
  
  return { 'date-parts': [[new Date().getFullYear()]] };
}

/**
 * Generate unique ID from source data
 */
function generateId(source: SourceData): string {
  if (source.doi) {
    return source.doi;
  }
  
  const title = (source.title || '').slice(0, 50);
  const authors = source.authors || source.author || [];
  let firstAuthor = '';
  
  if (authors.length > 0) {
    const author = authors[0];
    if (typeof author === 'string') {
      firstAuthor = author.split(' ').pop() || '';
    } else if (typeof author === 'object') {
      firstAuthor = author.family || author.lastName || '';
      if (!firstAuthor && author.name) {
        if (typeof author.name === 'string') {
          firstAuthor = author.name.split(' ').pop() || '';
        } else if (typeof author.name === 'object') {
          firstAuthor = author.name.family || '';
        }
      }
    }
  }
  
  // Simple hash
  const content = `${title}${firstAuthor}`.toLowerCase();
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  return Math.abs(hash).toString(16).slice(0, 12);
}

/**
 * Extract all citation metadata from HTML content
 */
export function extractCitationsFromHtml(html: string): CitationMetadata[] {
  const pattern = /data-citation="([^"]+)"/g;
  const seenIds = new Set<string>();
  const citations: CitationMetadata[] = [];
  
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const metadata = decodeCitation(match[1]);
    if (metadata) {
      const uniqueId = metadata.DOI || metadata.id;
      if (uniqueId && !seenIds.has(uniqueId)) {
        seenIds.add(uniqueId);
        citations.push(metadata);
      }
    }
  }
  
  return citations;
}

/**
 * Create citation HTML span with embedded metadata
 */
export function createCitationSpan(
  metadata: CitationMetadata,
  inTextCitation: string
): string {
  const encoded = encodeCitation(metadata);
  const entryId = metadata.DOI || metadata.id;
  
  return `<span class="citation-inline" data-citation="${encoded}" data-csl-entry-id="${entryId}" contenteditable="false">${inTextCitation}</span>`;
}

