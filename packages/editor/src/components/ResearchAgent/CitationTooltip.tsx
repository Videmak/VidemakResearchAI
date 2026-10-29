"use client";

/**
 * CitationTooltip - Shows article preview on citation hover
 * 
 * Displays a rich tooltip with article metadata when hovering over citations:
 * - Article type badge + Open Access indicator
 * - Full title
 * - Authors
 * - Journal + year
 * - Abstract/snippet preview
 * - Action buttons (Edit, Narrative, View, Save)
 * 
 * @version 1.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LuBookmark, LuCheck, LuExternalLink, LuPencil } from 'react-icons/lu';
import {
  getBibtexFromBase64,
  getDecodedCitationPayload,
} from '../../lib/citations/citationService';
import { Cite } from '@citation-js/core';
import '@citation-js/plugin-bibtex';

// ============================================================================
// Types
// ============================================================================

export interface CitationMetadata {
  id: string;
  title: string;
  authors: string[];
  year: string;
  journal?: string;
  doi?: string;
  url?: string;
  abstract?: string;
  type?: 'article' | 'book' | 'inproceedings' | 'misc';
  isOpenAccess?: boolean;
  citedBy?: number;
}

export type CitationLookupResult = Partial<Pick<CitationMetadata, 'abstract' | 'isOpenAccess' | 'citedBy' | 'journal' | 'url'>>;

interface TooltipPosition {
  x: number;
  y: number;
  placement: 'top' | 'bottom';
}

export interface CitationTooltipProps {
  /** Container element to attach event listeners */
  containerRef: React.RefObject<HTMLElement>;
  /** Callback when "Edit" is clicked (with the citation element) */
  onEdit?: (metadata: CitationMetadata, target: HTMLElement | null) => void;
  /** Callback when "View" is clicked */
  onView?: (metadata: CitationMetadata) => void;
  /** Callback when "Save" is clicked */
  onSave?: (metadata: CitationMetadata) => void;
  /** Callback when "Narrative" is clicked (with the citation element) */
  onNarrative?: (metadata: CitationMetadata, target: HTMLElement | null) => void;
  /** Extra details (cited by, open access, abstract) fetched when the card opens */
  lookup?: (metadata: CitationMetadata) => Promise<CitationLookupResult | null>;
  /** Also open the card on click and keep it open (touch screens) */
  openOnClick?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse BibTeX string to extract metadata
 */
export function parseBibtexToMetadata(bibtex: string): CitationMetadata | null {
  try {
    const cite = new Cite(bibtex);
    const item = Array.isArray(cite.data) ? cite.data[0] as any : null;
    if (!item || !item.title) return null;
    const dateParts = item.issued?.['date-parts'];
    const year = Array.isArray(dateParts) && Array.isArray(dateParts[0])
      ? String(dateParts[0][0] || '')
      : '';
    const authors = (Array.isArray(item.author) ? item.author : [])
      .map((author: any) => author.literal || [author.given, author.family].filter(Boolean).join(' '))
      .filter(Boolean);
    const container = Array.isArray(item['container-title'])
      ? item['container-title'][0]
      : item['container-title'];
    const typeMap: Record<string, CitationMetadata['type']> = {
      'article-journal': 'article',
      book: 'book',
      chapter: 'inproceedings',
      'paper-conference': 'inproceedings',
    };
    return {
      id: String(item.id || item['citation-key'] || 'unknown'),
      title: String(item.title),
      authors,
      year,
      journal: container ? String(container) : undefined,
      doi: item.DOI ? String(item.DOI) : undefined,
      url: item.URL ? String(item.URL) : undefined,
      abstract: item.abstract ? String(item.abstract) : undefined,
      type: typeMap[item.type] || 'misc',
      isOpenAccess: false,
    };
  } catch (e) {
    console.error('Error parsing BibTeX:', e);
    return null;
  }
}

/**
 * Get entry type display name
 */
const CARD_ACTION = 'inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-[12.5px] font-medium text-[#475569] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]';

/** "Rasch B, Born J" (two authors) or "Walker M et al." (more), as on the mockup's card. */
function shortAuthorList(authors: string[]): string {
  const names = (authors || []).map((name) => String(name || '').trim()).filter(Boolean).map((name) => {
    if (name.includes(',')) {
      const [last, first] = name.split(',');
      return `${last.trim()}${first?.trim() ? ` ${first.trim()[0]}` : ''}`;
    }
    const parts = name.split(/\s+/);
    const last = parts.pop() || name;
    return parts.length ? `${last} ${parts[0][0]}` : last;
  });
  if (names.length > 2) return `${names[0]} et al.`;
  return names.join(', ');
}

function getEntryTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    article: 'Article',
    book: 'Book',
    inproceedings: 'Conference Paper',
    incollection: 'Book Chapter',
    phdthesis: 'PhD Thesis',
    mastersthesis: 'Master\'s Thesis',
    techreport: 'Technical Report',
    misc: 'Other',
  };
  return labels[type] || 'Article';
}

// ============================================================================
// Main Component
// ============================================================================

const CitationTooltip: React.FC<CitationTooltipProps> = ({
  containerRef,
  onEdit,
  onView,
  onSave,
  onNarrative,
  lookup,
  openOnClick = false,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ x: 0, y: 0, placement: 'bottom' });
  const [metadata, setMetadata] = useState<CitationMetadata | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentTargetRef = useRef<HTMLElement | null>(null);
  const pinnedRef = useRef(false);
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;
  const [isNarrative, setIsNarrative] = useState(false);

  /**
   * Show tooltip for a citation element
   */
  const showTooltip = useCallback((target: HTMLElement) => {
    // Clear any pending hide timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    // Get citation data
    const base64Data = target.getAttribute('data-citation');
    if (!base64Data) return;

    const payload = getDecodedCitationPayload(base64Data);
    const bibtex = getBibtexFromBase64(base64Data);
    if (!bibtex) return;

    const canonical = payload?.citation_metadata;
    const parsed = canonical?.title ? {
      id: canonical.id || 'unknown',
      title: canonical.title,
      authors: canonical.authors || [],
      year: canonical.year ? String(canonical.year) : '',
      journal: canonical.journal || undefined,
      doi: canonical.doi || undefined,
      url: canonical.url || undefined,
      type: 'article' as const,
      isOpenAccess: false,
    } : parseBibtexToMetadata(bibtex);
    if (!parsed) return;

    // Calculate position
    const rect = target.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const tooltipHeight = 280; // Approximate height
    
    // Determine if tooltip should go above or below
    const spaceBelow = viewportHeight - rect.bottom;
    const placement = spaceBelow < tooltipHeight && rect.top > tooltipHeight ? 'top' : 'bottom';
    
    setPosition({
      x: rect.left + rect.width / 2,
      y: placement === 'bottom' ? rect.bottom + 8 : rect.top - 8,
      placement,
    });
    
    setMetadata(parsed);
    setIsSaved(false);
    setIsVisible(true);
    setIsNarrative(target.getAttribute('data-mode') === 'narrative');
    currentTargetRef.current = target;
    const fetchDetails = lookupRef.current;
    if (fetchDetails) {
      void fetchDetails(parsed)
        .then((extra) => {
          if (!extra || currentTargetRef.current !== target) return;
          setMetadata((current) => (current ? { ...current, ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined && value !== null && value !== '')) } : current));
        })
        .catch(() => undefined);
    }
  }, []);

  /**
   * Hide tooltip with delay
   */
  const hideTooltip = useCallback(() => {
    if (pinnedRef.current) return;
    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
      setMetadata(null);
      currentTargetRef.current = null;
    }, 150);
  }, []);

  /**
   * Keep tooltip visible when hovering over it
   */
  const handleTooltipMouseEnter = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  /**
   * Hide when leaving tooltip
   */
  const handleTooltipMouseLeave = useCallback(() => {
    hideTooltip();
  }, [hideTooltip]);

  /**
   * Handle save click
   */
  const handleSave = useCallback(() => {
    if (metadata && onSave) {
      onSave(metadata);
      setIsSaved(true);
    }
  }, [metadata, onSave]);

  /**
   * Setup event listeners on container
   */
  useEffect(() => {
    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-citation]') : null;
      if (target && containerRef.current?.contains(target)) {
        showTooltip(target);
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target.closest('[data-citation]') : null;
      if (!target || !containerRef.current?.contains(target)) return;
      const relatedTarget = e.relatedTarget instanceof Element ? e.relatedTarget : null;
      
      // Don't hide if moving to tooltip or another citation
      if (relatedTarget && tooltipRef.current?.contains(relatedTarget)) return;
      if (relatedTarget && target.contains(relatedTarget)) return;
      
      if (target) {
        hideTooltip();
      }
    };

    // The document surface can mount later or be replaced while streaming.
    // Delegate once and consult the live ref rather than a stale DOM node.
    const handleClick = (e: MouseEvent) => {
      if (!openOnClick) return;
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-citation]') : null;
      if (target && containerRef.current?.contains(target)) {
        pinnedRef.current = true;
        showTooltip(target);
        return;
      }
      if (tooltipRef.current && e.target instanceof Node && tooltipRef.current.contains(e.target)) return;
      if (pinnedRef.current) {
        pinnedRef.current = false;
        setIsVisible(false);
      }
    };

    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
    document.addEventListener('click', handleClick, true);
    const dismiss = () => {
      pinnedRef.current = false;
      setIsVisible(false);
    };
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);

    return () => {
      document.removeEventListener('mouseover', handleMouseOver);
      document.removeEventListener('mouseout', handleMouseOut);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [containerRef, showTooltip, hideTooltip, openOnClick]);

  // Don't render if not visible or no metadata
  if (!isVisible || !metadata) return null;

  const truncatedAbstract = metadata.abstract 
    ? metadata.abstract.length > 180 
      ? metadata.abstract.substring(0, 180) + '...'
      : metadata.abstract
    : null;

  // A portal avoids transformed/overflow-clipped Generator editor ancestors.
  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={tooltipRef}
        initial={{ opacity: 0, scale: 0.95, y: position.placement === 'bottom' ? -5 : 5 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        onMouseEnter={handleTooltipMouseEnter}
        onMouseLeave={handleTooltipMouseLeave}
        role="tooltip"
        className="fixed z-[16000] w-[340px] max-w-[calc(100vw-20px)] overflow-hidden rounded-[14px] border border-[#e5e7eb] bg-white px-3.5 pb-2.5 pt-3 shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)]"
        style={{
          left: Math.max(10, Math.min(position.x - 175, window.innerWidth - 360)),
          top: position.placement === 'bottom' ? position.y : 'auto',
          bottom: position.placement === 'top' ? window.innerHeight - position.y : 'auto',
          transformOrigin: position.placement === 'bottom' ? 'top center' : 'bottom center',
        }}
      >
        <div className="mb-1 flex flex-wrap items-center gap-x-2 text-[11.5px] font-medium text-[#94a3b8]">
          <span>{[getEntryTypeLabel(metadata.type || 'article'), typeof metadata.citedBy === 'number' && metadata.citedBy > 0 ? `Cited by ${metadata.citedBy.toLocaleString()}` : null].filter(Boolean).join(' · ')}</span>
          {metadata.isOpenAccess ? <span className="inline-flex items-center gap-1 text-[#15803d]"><span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />Open access</span> : null}
        </div>

        <h4 className="line-clamp-2 text-[14.5px] font-semibold leading-[1.4] text-[#0f172a]">{metadata.title}</h4>
        <div className="mt-0.5 line-clamp-1 text-[12.5px] text-[#64748b]">
          {[shortAuthorList(metadata.authors), metadata.journal, metadata.year].filter(Boolean).join(' · ')}
        </div>

        {truncatedAbstract ? (
          <p className="mt-2 line-clamp-3 text-[12.5px] leading-[1.5] text-[#475569]">{truncatedAbstract}</p>
        ) : null}

        {onEdit || onNarrative || onView || onSave ? (
          <div className="-ml-1 mt-2.5 flex flex-wrap items-center gap-0.5">
            {onSave ? (
              <button
                type="button"
                onClick={handleSave}
                aria-pressed={isSaved}
                className={isSaved
                  ? 'mr-1 inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg bg-[#f0fdf4] px-2.5 text-[12.5px] font-semibold text-[#15803d]'
                  : 'mr-1 inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg bg-[var(--theme-primary,#2563eb)] px-2.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#1d4ed8]'}
              >
                {isSaved ? <><LuCheck className="h-3.5 w-3.5" />Saved</> : <><LuBookmark className="h-3.5 w-3.5" />Save</>}
              </button>
            ) : null}
            {onView ? (
              <button type="button" onClick={() => onView(metadata)} className={CARD_ACTION}>
                <LuExternalLink className="h-3.5 w-3.5" />{metadata.isOpenAccess ? 'PDF' : 'Open'}
              </button>
            ) : null}
            {onNarrative ? (
              <button
                type="button"
                title={isNarrative ? 'Show as (Author, Year)' : 'Show as Author (Year)'}
                onClick={() => {
                  const target = currentTargetRef.current;
                  onNarrative(metadata, target);
                  setIsNarrative((value) => !value);
                }}
                className={CARD_ACTION}
              >
                {isNarrative ? '(Author, Year)' : 'Author (Year)'}
              </button>
            ) : null}
            {onEdit ? (
              <button
                type="button"
                aria-label="Edit citation"
                title="Edit citation"
                onClick={() => {
                  pinnedRef.current = false;
                  setIsVisible(false);
                  onEdit(metadata, currentTargetRef.current);
                }}
                className={`${CARD_ACTION} ml-auto`}
              >
                <LuPencil className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
};

export default CitationTooltip;
export { CitationTooltip };
