/**
 * Citation Types - Self-Contained Citation System
 * 
 * These types define the structure of citation metadata that gets
 * embedded directly in HTML as base64-encoded JSON.
 */

/**
 * Author representation in CSL-JSON format
 */
export interface CitationAuthor {
  family: string;
  given?: string;
  literal?: string;
}

/**
 * Date representation in CSL-JSON format
 */
export interface CitationDate {
  'date-parts'?: number[][];
  literal?: string;
  raw?: string;
}

/**
 * Full citation metadata in CSL-JSON format
 * This is what gets embedded in the HTML
 */
export interface CitationMetadata {
  id: string;
  type: string;
  title: string;
  author: CitationAuthor[];
  issued: CitationDate;
  
  // Optional fields
  DOI?: string;
  URL?: string;
  'container-title'?: string;  // Journal/book title
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  abstract?: string;
  ISSN?: string[];
  ISBN?: string[];
  
  // Custom fields
  accessed?: CitationDate;
  note?: string;
}

/**
 * Source data as it comes from literature search APIs
 * (OpenAlex, Semantic Scholar, etc.)
 */
export interface SourceData {
  id?: string;
  doi?: string;
  title: string;
  authors?: (string | AuthorInput)[];
  author?: (string | AuthorInput)[];
  contributors?: ContributorInput[];
  year?: number | string;
  publication_year?: number;
  issuedDate?: string;
  published_date?: string;
  date?: string;
  journal?: string;
  'container-title'?: string;
  volume?: number | string;
  issue?: number | string;
  pages?: string;
  publisher?: string;
  abstract?: string;
  url?: string;
  issn?: string | string[];
  isbn?: string | string[];
}

/**
 * Author input formats
 */
export interface AuthorInput {
  family?: string;
  given?: string;
  name?: string | { family?: string; given?: string };
  lastName?: string;
  firstName?: string;
}

/**
 * Contributor format (from some APIs)
 */
export interface ContributorInput {
  role?: number;
  name?: { family?: string; given?: string };
}

/**
 * Formatted reference for display
 */
export interface FormattedReference {
  id: string;
  html: string;
  metadata: CitationMetadata;
}

/**
 * Available citation styles
 */
export type CitationStyle = 
  | 'apa'
  | 'apa-7'
  | 'apa-6'
  | 'mla'
  | 'chicago'
  | 'chicago-author-date'
  | 'chicago-note'
  | 'harvard'
  | 'ieee'
  | 'vancouver'
  | 'oscola'
  | 'ama'
  | 'nature'
  | 'science'
  | 'turabian'
  | string;

/**
 * Style metadata
 */
export interface StyleInfo {
  id: CitationStyle;
  name: string;
  category: 'author-date' | 'numeric' | 'note' | 'label';
}

/**
 * Common citation styles with display names
 */
export const CITATION_STYLES: StyleInfo[] = [
  { id: 'apa', name: 'APA 7th', category: 'author-date' },
  { id: 'apa-6th-edition', name: 'APA 6th', category: 'author-date' },
  { id: 'modern-language-association', name: 'MLA 9th', category: 'author-date' },
  { id: 'chicago-author-date', name: 'Chicago (Author-Date)', category: 'author-date' },
  { id: 'chicago-note-bibliography', name: 'Chicago (Notes)', category: 'note' },
  { id: 'harvard-cite-them-right', name: 'Harvard', category: 'author-date' },
  { id: 'ieee', name: 'IEEE', category: 'numeric' },
  { id: 'vancouver', name: 'Vancouver', category: 'numeric' },
  { id: 'oscola', name: 'OSCOLA', category: 'note' },
  { id: 'american-medical-association', name: 'AMA', category: 'numeric' },
  { id: 'nature', name: 'Nature', category: 'numeric' },
  { id: 'science', name: 'Science', category: 'numeric' },
  { id: 'turabian-fullnote-bibliography', name: 'Turabian', category: 'note' },
];

