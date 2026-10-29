/**
 * Citation System - Self-Contained Citations with 10,000+ CSL Styles
 * 
 * This module provides a complete citation system where all metadata
 * is embedded directly in HTML as base64-encoded JSON.
 * 
 * Usage:
 * 
 * 1. When inserting a citation:
 *    import { sourceToMetadata, encodeCitation, createCitationSpan } from './index';
 *    const metadata = sourceToMetadata(sourceFromApi);
 *    const span = createCitationSpan(metadata, '(Author, 2023)');
 * 
 * 2. When changing styles:
 *    import { reformatCitationsInHtml } from './index';
 *    const newHtml = await reformatCitationsInHtml(html, 'ieee');
 * 
 * 3. When displaying references:
 *    import { getReferencesFromHtml } from './index';
 *    const refs = await getReferencesFromHtml(html, 'apa');
 * 
 * 4. When searching for styles:
 *    import { searchStyles, COMMON_STYLES } from './index';
 *    const results = await searchStyles('medicine', { limit: 20 });
 */

// Types
export type {
  CitationMetadata,
  CitationAuthor,
  CitationDate,
  SourceData,
  AuthorInput,
  ContributorInput,
  FormattedReference,
  CitationStyle,
  StyleInfo,
} from './types';

export { CITATION_STYLES } from './types';

// Encoding/Decoding
export {
  encodeCitation,
  decodeCitation,
  sourceToMetadata,
  extractCitationsFromHtml,
  createCitationSpan,
} from './encoder';

// Formatting
export {
  normalizeStyleName,
  loadCslStyle,
  formatInText,
  formatBibliography,
  formatBibliographyList,
  reformatCitationsInHtml,
  getReferencesFromHtml,
} from './formatter';

// CSL Styles (10,000+ styles support)
export type { CslStyleInfo, StyleSearchResult } from './cslStyles';
export {
  COMMON_STYLES,
  commonStyles,
  normalizeStyleId,
  loadCslStyle as loadStyle,
  isStyleLoaded,
  preloadCommonStyles,
  searchStyles,
  getStyleInfo,
  getStyleDisplayName,
  isNumericStyle,
  getCategoryLabel,
} from './cslStyles';
