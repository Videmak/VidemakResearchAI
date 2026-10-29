/**
 * Citation API Service
 * 
 * Integrates with the Videmak Citation Wizard API to generate
 * perfectly formatted citations from PDFs, URLs, DOIs, and more.
 * Supports 10,000+ citation styles via CSL (Citation Style Language).
 */

import { COMMON_STYLES, searchStyles, getStyleInfo, type CslStyleInfo } from '../lib/citations/cslStyles';
import { getApiBase } from './auth/api';
import { postDurableForm, postDurableJson } from './jobsApi';

// ============================================================================
// Types
// ============================================================================

// Citation style ID can be any string (supports 10,000+ styles)
export type CitationStyleId = string;

export interface CitationStyle {
  id: CitationStyleId;
  name: string;
  category?: 'author-date' | 'numeric' | 'note' | 'label';
  shortTitle?: string;
}

export interface InTextCitation {
  citation: string;
  type?: 'parenthetical' | 'narrative';
}

export interface CitationResponse {
  success: boolean;
  style: string;
  inTextCitations: InTextCitation[];
  bibliography: string[];
  itemCount: number;
  bibtex?: string;
  error?: string;
}

export interface CitationRequest {
  input: string;
  style: CitationStyleId;
  format: 'html' | 'text' | 'json' | 'bibtex';
}

export interface StoredCitation {
  id: string;
  input: string;
  inputType: 'url' | 'doi' | 'isbn' | 'pmid' | 'arxiv' | 'pdf';
  style: CitationStyleId;
  bibliography: string;
  inTextCitations: InTextCitation[];
  parenthetical?: string;
  narrative?: string;
  bibtex?: string;
  createdAt: Date;
  title?: string;
  authors?: string;
  year?: string;
}

export interface CitationFolder {
  id: string;
  name: string;
  citationCount: number;
  createdAt: Date;
}

// ============================================================================
// Available Styles (10,000+ via CSL)
// ============================================================================

/**
 * Get common citation styles (quick access)
 */
export function getCommonStyles(): CitationStyle[] {
  return COMMON_STYLES.map(style => ({
    id: style.id,
    name: style.title,
    category: style.category,
    shortTitle: style.shortTitle,
  }));
}

/**
 * Search for citation styles (supports 10,000+ styles)
 */
export async function searchCitationStyles(
  query: string = '',
  options?: {
    limit?: number;
    category?: 'author-date' | 'numeric' | 'note' | 'label';
    field?: string;
  }
): Promise<CitationStyle[]> {
  const result = await searchStyles(query, {
    limit: options?.limit || 100,
    category: options?.category,
    field: options?.field,
    includeAll: true, // Include all 10,000+ styles
  });
  
  return result.styles.map(style => ({
    id: style.id,
    name: style.title,
    category: style.category,
    shortTitle: style.shortTitle,
  }));
}

/**
 * Get all available styles (for backward compatibility)
 * Now returns common styles by default, use searchCitationStyles for full search
 */
export const AVAILABLE_STYLES: CitationStyle[] = getCommonStyles();

// ============================================================================
// Input Detection
// ============================================================================

/**
 * Detect the type of input (URL, DOI, ISBN, etc.)
 */
export function detectInputType(input: string): 'url' | 'doi' | 'isbn' | 'pmid' | 'arxiv' | 'pdf' | 'unknown' {
  const trimmed = input.trim();
  
  // DOI patterns
  if (/^10\.\d{4,}\//.test(trimmed) || /^doi:/i.test(trimmed)) {
    return 'doi';
  }
  
  // PubMed ID
  if (/^pmid:\s*\d+$/i.test(trimmed) || /^\d{7,8}$/.test(trimmed)) {
    return 'pmid';
  }
  
  // ISBN
  if (/^(isbn[:\s-]?)?(97[89])?\d{9}[\dxX]$/i.test(trimmed.replace(/[-\s]/g, ''))) {
    return 'isbn';
  }
  
  // arXiv
  if (/^arxiv:/i.test(trimmed) || /^\d{4}\.\d{4,5}(v\d+)?$/.test(trimmed)) {
    return 'arxiv';
  }
  
  // PDF URL
  if (/^https?:\/\/.+\.pdf(\?.*)?$/i.test(trimmed)) {
    return 'pdf';
  }
  
  // General URL
  if (/^https?:\/\//i.test(trimmed)) {
    return 'url';
  }
  
  return 'unknown';
}

/**
 * Get a human-readable label for input type
 */
export function getInputTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    url: 'Website',
    doi: 'DOI',
    isbn: 'ISBN',
    pmid: 'PubMed',
    arxiv: 'arXiv',
    pdf: 'PDF',
    unknown: 'Text',
  };
  return labels[type] || 'Unknown';
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Generate citation from input (URL, DOI, ISBN, etc.)
 */
export async function generateCitation(request: CitationRequest): Promise<CitationResponse> {
  try {
    const apiBase = getApiBase();
    return await postDurableJson<CitationResponse>(
      `${apiBase}/api/citations/generate`,
      request,
    );
  } catch (error: any) {
    console.error('Citation generation error:', error);
    return {
      success: false,
      style: request.style,
      inTextCitations: [],
      bibliography: [],
      itemCount: 0,
      error: error.message || 'Failed to generate citation',
    };
  }
}

/**
 * Generate citation from uploaded file (PDF, BibTeX, RIS)
 */
export async function generateCitationFromFile(
  file: File,
  style: CitationStyleId,
  format: 'html' | 'text' = 'html'
): Promise<CitationResponse> {
  try {
    const apiBase = getApiBase();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('style', style);
    formData.append('format', format);
    return await postDurableForm<CitationResponse>(
      `${apiBase}/api/citations/upload`,
      formData,
    );
  } catch (error: any) {
    console.error('File citation error:', error);
    return {
      success: false,
      style: style,
      inTextCitations: [],
      bibliography: [],
      itemCount: 0,
      error: error.message || 'Failed to process file',
    };
  }
}

/**
 * Get available citation styles
 * Now uses CSL styles system (10,000+ styles available)
 */
export async function getAvailableStyles(query?: string): Promise<CitationStyle[]> {
  if (query) {
    return searchCitationStyles(query);
  }
  return getCommonStyles();
}

/**
 * Get style info by ID
 */
export async function getStyleById(styleId: string): Promise<CitationStyle | null> {
  const styleInfo = await getStyleInfo(styleId);
  if (!styleInfo) return null;
  
  return {
    id: styleInfo.id,
    name: styleInfo.title,
    category: styleInfo.category,
    shortTitle: styleInfo.shortTitle,
  };
}

/**
 * Check API health
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const apiBase = getApiBase();
    const token = getAuthToken();
    const response = await fetch(`${apiBase}/api/citations/health`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// API Configuration
// ============================================================================

// Get auth token from localStorage
const getAuthToken = (): string | null => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('auth_token');
  }
  return null;
};

// ============================================================================
// Backend API Functions for Citations
// ============================================================================

/**
 * Load citations from backend API
 * Returns empty array if not authenticated
 */
export async function loadStoredCitations(): Promise<StoredCitation[]> {
  if (typeof window === 'undefined') return [];
  
  const token = getAuthToken();
  if (!token) {
    console.log('[Citations] No auth token, returning empty citations');
    return [];
  }
  
  try {
    const apiBase = getApiBase();
    const response = await fetch(`${apiBase}/api/citations`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        console.log('[Citations] Not authenticated');
        return [];
      }
      throw new Error(`Failed to load citations: ${response.status}`);
    }
    
    const data = await response.json();
    return (data.citations || []).map((c: any) => ({
      ...c,
      createdAt: new Date(c.createdAt),
    }));
  } catch (error) {
    console.error('[Citations] Error loading citations:', error);
    return [];
  }
}

/**
 * Save citation to backend API
 */
export async function saveCitation(citation: StoredCitation): Promise<StoredCitation | null> {
  if (typeof window === 'undefined') return null;
  
  const token = getAuthToken();
  if (!token) {
    console.error('[Citations] Cannot save citation: not authenticated');
    return null;
  }
  
  try {
    const apiBase = getApiBase();
    
    // Map frontend camelCase to backend snake_case
    const payload = {
      input: citation.input,
      input_type: citation.inputType,
      style: citation.style,
      bibliography: citation.bibliography,
      in_text_citations: citation.inTextCitations,
      parenthetical: citation.parenthetical,
      narrative: citation.narrative,
      title: citation.title,
      authors: citation.authors,
      year: citation.year,
      folder_id: 'default',
    };
    
    const response = await fetch(`${apiBase}/api/citations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to save citation: ${response.status}`);
    }
    
    const saved = await response.json();
    return {
      ...saved,
      createdAt: new Date(saved.createdAt),
    };
  } catch (error) {
    console.error('[Citations] Error saving citation:', error);
    return null;
  }
}

/**
 * Update citation in backend API
 */
export async function updateCitation(id: string, updates: Partial<StoredCitation>): Promise<StoredCitation | null> {
  if (typeof window === 'undefined') return null;
  
  const token = getAuthToken();
  if (!token) {
    console.error('[Citations] Cannot update citation: not authenticated');
    return null;
  }
  
  try {
    const apiBase = getApiBase();
    
    // Map frontend camelCase to backend snake_case
    const payload: any = {};
    if (updates.style) payload.style = updates.style;
    if (updates.bibliography) payload.bibliography = updates.bibliography;
    if (updates.inTextCitations) payload.in_text_citations = updates.inTextCitations;
    if (updates.parenthetical) payload.parenthetical = updates.parenthetical;
    if (updates.narrative) payload.narrative = updates.narrative;
    
    const response = await fetch(`${apiBase}/api/citations/${id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to update citation: ${response.status}`);
    }
    
    const updated = await response.json();
    return {
      ...updated,
      createdAt: new Date(updated.createdAt),
    };
  } catch (error) {
    console.error('[Citations] Error updating citation:', error);
    return null;
  }
}

/**
 * Delete citation from backend API
 */
export async function deleteCitation(id: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  
  const token = getAuthToken();
  if (!token) {
    console.error('[Citations] Cannot delete citation: not authenticated');
    return false;
  }
  
  try {
    const apiBase = getApiBase();
    const response = await fetch(`${apiBase}/api/citations/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to delete citation: ${response.status}`);
    }
    
    return true;
  } catch (error) {
    console.error('[Citations] Error deleting citation:', error);
    return false;
  }
}

/**
 * Clear all stored citations (backend operation)
 */
export function clearAllCitations(): void {
  // This would require a backend endpoint to delete all citations
  // For now, this is a no-op since we don't want to accidentally delete all data
  console.warn('[Citations] clearAllCitations not implemented for backend');
}

/**
 * Load folders from backend API
 */
export async function loadFolders(): Promise<CitationFolder[]> {
  if (typeof window === 'undefined') return [];
  
  const token = getAuthToken();
  if (!token) {
    // Return default folder for unauthenticated users
    return [{
      id: 'default',
      name: 'References',
      citationCount: 0,
      createdAt: new Date(),
    }];
  }
  
  try {
    const apiBase = getApiBase();
    const response = await fetch(`${apiBase}/api/citations/folders/list`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        return [{
          id: 'default',
          name: 'References',
          citationCount: 0,
          createdAt: new Date(),
        }];
      }
      throw new Error(`Failed to load folders: ${response.status}`);
    }
    
    const data = await response.json();
    return (data.folders || []).map((f: any) => ({
      ...f,
      createdAt: new Date(f.createdAt),
    }));
  } catch (error) {
    console.error('[Citations] Error loading folders:', error);
    return [{
      id: 'default',
      name: 'References',
      citationCount: 0,
      createdAt: new Date(),
    }];
  }
}

/**
 * Save/create folder to backend API
 */
export async function saveFolders(folders: CitationFolder[]): Promise<void> {
  // This function signature is kept for backward compatibility
  // In the new API, we create folders one at a time
  // This is primarily used after creating a new folder
  console.log('[Citations] saveFolders called - folders are now managed via API');
}

/**
 * Create a new folder
 */
export async function createFolder(name: string): Promise<CitationFolder | null> {
  if (typeof window === 'undefined') return null;
  
  const token = getAuthToken();
  if (!token) {
    console.error('[Citations] Cannot create folder: not authenticated');
    return null;
  }
  
  try {
    const apiBase = getApiBase();
    const response = await fetch(`${apiBase}/api/citations/folders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to create folder: ${response.status}`);
    }
    
    const folder = await response.json();
    return {
      ...folder,
      createdAt: new Date(folder.createdAt),
    };
  } catch (error) {
    console.error('[Citations] Error creating folder:', error);
    return null;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate unique ID
 */
export function generateId(): string {
  return `cite_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Extract metadata from bibliography string
 */
export function extractMetadataFromBibliography(bibliography: string): {
  title?: string;
  authors?: string;
  year?: string;
} {
  // Simple extraction - works for most citation styles
  const yearMatch = bibliography.match(/\((\d{4})\)/);
  const year = yearMatch ? yearMatch[1] : undefined;
  
  // Try to extract authors (text before the year)
  const authorsMatch = bibliography.match(/^([^(]+)/);
  const authors = authorsMatch ? authorsMatch[1].trim().replace(/\.$/, '') : undefined;
  
  // Try to extract title (usually in italics or between periods)
  const titleMatch = bibliography.match(/<em>([^<]+)<\/em>/) || 
                     bibliography.match(/\)\.\s*([^.]+)\./);
  const title = titleMatch ? titleMatch[1].trim() : undefined;
  
  return { title, authors, year };
}

/**
 * Format citation for copying to clipboard
 */
export function formatCitationForClipboard(citation: StoredCitation, type: 'bibliography' | 'parenthetical' | 'narrative'): string {
  switch (type) {
    case 'parenthetical':
      return citation.parenthetical || citation.inTextCitations[0]?.citation || '';
    case 'narrative':
      return citation.narrative || '';
    case 'bibliography':
    default:
      // Strip HTML tags for plain text
      return citation.bibliography.replace(/<[^>]*>/g, '');
  }
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      return true;
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}
