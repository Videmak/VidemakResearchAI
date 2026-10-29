/**
 * useCitations Hook - React hook for managing embedded citations
 * 
 * Provides:
 * - Citation style management
 * - Automatic reformatting on style change
 * - References list extraction
 * - Real-time sync between content and references
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { CitationMetadata, CitationStyle, FormattedReference } from './types';
import {
  reformatCitationsInHtml,
  getReferencesFromHtml,
} from './formatter';
import { extractCitationsFromHtml } from './encoder';

interface UseCitationsOptions {
  initialStyle?: CitationStyle;
  content?: string;
  onContentChange?: (content: string) => void;
  onReferencesChange?: (references: FormattedReference[]) => void;
}

interface UseCitationsReturn {
  // Current state
  style: CitationStyle;
  references: FormattedReference[];
  isReformatting: boolean;
  citationCount: number;
  
  // Actions
  setStyle: (style: CitationStyle) => Promise<void>;
  reformatContent: (content: string, style?: CitationStyle) => Promise<string>;
  getReferences: (content: string) => Promise<FormattedReference[]>;
  refreshReferences: () => Promise<void>;
}

export function useCitations(options: UseCitationsOptions = {}): UseCitationsReturn {
  const {
    initialStyle = 'apa',
    content: initialContent = '',
    onContentChange,
    onReferencesChange,
  } = options;
  
  const [style, setStyleState] = useState<CitationStyle>(initialStyle);
  const [references, setReferences] = useState<FormattedReference[]>([]);
  const [isReformatting, setIsReformatting] = useState(false);
  const [citationCount, setCitationCount] = useState(0);
  
  const contentRef = useRef(initialContent);
  
  // Update content ref when it changes
  useEffect(() => {
    contentRef.current = initialContent;
    // Count citations in content
    const count = extractCitationsFromHtml(initialContent).length;
    setCitationCount(count);
  }, [initialContent]);
  
  /**
   * Change citation style and reformat all content
   */
  const setStyle = useCallback(async (newStyle: CitationStyle) => {
    if (newStyle === style) return;
    
    setIsReformatting(true);
    
    try {
      // Reformat current content
      if (contentRef.current) {
        const reformatted = await reformatCitationsInHtml(contentRef.current, newStyle);
        contentRef.current = reformatted;
        onContentChange?.(reformatted);
        
        // Update references with new style
        const refs = await getReferencesFromHtml(reformatted, newStyle);
        setReferences(refs);
        onReferencesChange?.(refs);
      }
      
      setStyleState(newStyle);
    } catch (error) {
      console.error('Error reformatting citations:', error);
    } finally {
      setIsReformatting(false);
    }
  }, [style, onContentChange, onReferencesChange]);
  
  /**
   * Reformat content with current or specified style
   */
  const reformatContent = useCallback(async (
    content: string,
    targetStyle?: CitationStyle
  ): Promise<string> => {
    const styleToUse = targetStyle || style;
    
    try {
      const reformatted = await reformatCitationsInHtml(content, styleToUse);
      return reformatted;
    } catch (error) {
      console.error('Error reformatting content:', error);
      return content;
    }
  }, [style]);
  
  /**
   * Get formatted references from content
   */
  const getReferences = useCallback(async (
    content: string
  ): Promise<FormattedReference[]> => {
    try {
      const refs = await getReferencesFromHtml(content, style);
      return refs;
    } catch (error) {
      console.error('Error getting references:', error);
      return [];
    }
  }, [style]);
  
  /**
   * Refresh references from current content
   */
  const refreshReferences = useCallback(async () => {
    if (contentRef.current) {
      const refs = await getReferencesFromHtml(contentRef.current, style);
      setReferences(refs);
      onReferencesChange?.(refs);
      setCitationCount(refs.length);
    }
  }, [style, onReferencesChange]);
  
  // Initial references load
  useEffect(() => {
    if (initialContent) {
      refreshReferences();
    }
  }, [initialContent, refreshReferences]);
  
  return {
    style,
    references,
    isReformatting,
    citationCount,
    setStyle,
    reformatContent,
    getReferences,
    refreshReferences,
  };
}

export default useCitations;

