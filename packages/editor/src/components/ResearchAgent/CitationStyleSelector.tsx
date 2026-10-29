"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  COMMON_STYLES,
  searchStyles,
  loadCslStyle,
  getStyleDisplayName,
  getCategoryLabel,
  type CslStyleInfo,
} from '../../lib/citations/cslStyles';

interface CitationStyleSelectorProps {
  selectedStyle: string;
  onStyleChange: (styleId: string) => void;
  className?: string;
  triggerClassName?: string;
  dropdownClassName?: string;
  hideExample?: boolean;
}

const CitationStyleSelector: React.FC<CitationStyleSelectorProps> = ({
  selectedStyle,
  onStyleChange,
  className = '',
  triggerClassName = '',
  dropdownClassName = '',
  hideExample = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<CslStyleInfo[]>([]);
  const [showAllStyles, setShowAllStyles] = useState(false);
  const [isLoadingStyle, setIsLoadingStyle] = useState(false);
  
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Get selected style info
  const selectedStyleInfo = useMemo(() => {
    const common = COMMON_STYLES.find(s => s.id === selectedStyle);
    if (common) return common;

    // Create a basic info for unknown styles
    return {
      id: selectedStyle,
      title: getStyleDisplayName(selectedStyle),
      shortTitle: selectedStyle.split('-').slice(0, 2).join(' ').toUpperCase(),
      category: 'author-date' as const,
    };
  }, [selectedStyle]);

  // Styles to display (common or search results)
  const displayStyles = useMemo(() => {
    if (searchQuery.trim()) {
      return searchResults;
    }
    return COMMON_STYLES;
  }, [searchQuery, searchResults]);

  // Group styles by category
  const groupedStyles = useMemo(() => {
    return displayStyles.reduce((acc, style) => {
    if (!acc[style.category]) {
      acc[style.category] = [];
    }
    acc[style.category].push(style);
    return acc;
    }, {} as Record<string, CslStyleInfo[]>);
  }, [displayStyles]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
        setShowAllStyles(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Search styles when query changes
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchStyles(searchQuery, {
          limit: 100,
          includeAll: showAllStyles,
        });
        setSearchResults(results.styles);
      } catch (error) {
        console.error('Error searching styles:', error);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, showAllStyles]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0 && listRef.current) {
      const focusedElement = listRef.current.querySelector(`[data-index="${focusedIndex}"]`);
      if (focusedElement) {
        focusedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [focusedIndex]);

  const handleStyleSelect = useCallback(async (styleId: string) => {
    setIsLoadingStyle(true);
    
    try {
      // Pre-load the style before switching
      await loadCslStyle(styleId);
      
      onStyleChange(styleId);
      setIsOpen(false);
      setSearchQuery('');
      setFocusedIndex(-1);
      setShowAllStyles(false);
    } catch (error) {
      console.error('Error loading style:', error);
      // Still switch even if loading fails - fallback will handle it
      onStyleChange(styleId);
    } finally {
      setIsLoadingStyle(false);
    }
  }, [onStyleChange]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        setIsOpen(false);
        setSearchQuery('');
        break;
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev => Math.min(prev + 1, displayStyles.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < displayStyles.length) {
          void handleStyleSelect(displayStyles[focusedIndex].id);
        }
        break;
    }
  }, [displayStyles, focusedIndex, handleStyleSelect, isOpen]);

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'author-date':
        return (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        );
      case 'numeric':
        return (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
          </svg>
        );
      case 'note':
        return (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
      default:
        return (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
        );
    }
  };

  const getExampleCitation = (style: CslStyleInfo) => {
    switch (style.category) {
      case 'numeric':
        return '[1]';
      case 'note':
        return '¹';
      case 'label':
        return '(1)';
      default:
        return '(Author, 2023)';
    }
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        disabled={isLoadingStyle}
        className={`flex items-center gap-1.5 px-2 py-1.5 md:px-3 md:py-1.5 bg-white border border-[#e5e7eb] rounded-lg 
                   hover:bg-[#f8fafc] hover:border-[#cbd5e1] transition-all duration-200
                   focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500
                   ${isLoadingStyle ? 'opacity-70 cursor-wait' : ''} ${triggerClassName}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Select citation style"
      >
        {isLoadingStyle ? (
          <svg className="animate-spin w-3 h-3 md:w-4 md:h-4 text-[#64748b] flex-shrink-0" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : (
        <svg className="w-3 h-3 md:w-4 md:h-4 text-[#64748b] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
        )}
        
        <span className="text-xs md:text-sm font-medium text-[#334155] truncate flex-1 min-w-0 max-w-[120px] md:max-w-[180px]">
          {selectedStyleInfo.shortTitle || selectedStyleInfo.title}
        </span>
        
        {!hideExample ? (
          <span className="text-xs text-[#94a3b8] hidden md:inline flex-shrink-0">
            {getExampleCitation(selectedStyleInfo)}
          </span>
        ) : null}
        
        <motion.svg
          className="w-3 h-3 md:w-4 md:h-4 text-[#94a3b8] flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </motion.svg>
      </button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className={`absolute top-full right-0 mt-1 w-[260px] bg-white rounded-lg shadow-xl 
                       border border-[#e5e7eb] overflow-hidden z-[1300] ${dropdownClassName}`}
            role="listbox"
          >
            {/* Search Input */}
            <div className="p-2 border-b border-[#f1f5f9]">
              <div className="relative">
                {isSearching ? (
                  <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-primary-500 animate-spin" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                <svg 
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#94a3b8]"
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                )}
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search styles..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setFocusedIndex(0);
                  }}
                  onKeyDown={handleKeyDown}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-[#e5e7eb] rounded-md
                             focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500
                             placeholder-[#94a3b8]"
                />
              </div>
              
              {/* Toggle for searching all styles */}
              <div className="flex items-center justify-between mt-1.5">
                <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-[#64748b]">
                  <input
                    type="checkbox"
                    checked={showAllStyles}
                    onChange={(e) => setShowAllStyles(e.target.checked)}
                    className="rounded border-[#e5e7eb] text-primary-600 focus:ring-primary-500 w-3 h-3"
                  />
                  <span>Search all CSL styles</span>
                </label>
                {showAllStyles && (
                  <span className="text-[10px] text-primary-600 font-medium">10,000+</span>
                )}
              </div>
            </div>

            {/* Quick Category Filters */}
            {!searchQuery && (
              <div className="px-2 py-1.5 border-b border-[#f1f5f9] flex gap-1 flex-wrap">
                {['all', 'author-date', 'numeric', 'note', 'label'].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      if (cat === 'all') {
                        setSearchQuery('');
                      } else {
                        setSearchQuery(cat);
                      }
                    }}
                    className={`px-1.5 py-0.5 text-[10px] rounded-full transition-colors ${
                      (cat === 'all' && !searchQuery) 
                        ? 'bg-primary-100 text-primary-700 font-medium'
                        : 'bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0]'
                    }`}
                  >
                    {cat === 'all' ? 'All' : getCategoryLabel(cat as CslStyleInfo['category'])}
                  </button>
                ))}
              </div>
            )}

            {/* Styles List */}
            <ul 
              ref={listRef}
              className="max-h-64 overflow-y-auto"
              role="listbox"
            >
              {Object.entries(groupedStyles).map(([category, styles]) => (
                <li key={category}>
                  {/* Category Header */}
                  <div className="px-2 py-1.5 bg-[#f8fafc] sticky top-0 z-10">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[#64748b] uppercase tracking-wider">
                      {getCategoryIcon(category)}
                      {getCategoryLabel(category as CslStyleInfo['category'])}
                      <span className="text-[#94a3b8] font-normal">({styles.length})</span>
                    </div>
                  </div>
                  
                  {/* Style Items */}
                  <ul>
                    {styles.map((style) => {
                      const globalIndex = displayStyles.indexOf(style);
                      const isSelected = style.id === selectedStyle;
                      const isFocused = globalIndex === focusedIndex;
                      
                      return (
                        <li
                          key={style.id}
                          data-index={globalIndex}
                          onClick={() => handleStyleSelect(style.id)}
                          className={`
                            px-2 py-1.5 cursor-pointer transition-colors duration-100
                            ${isSelected ? 'bg-primary-50' : ''}
                            ${isFocused ? 'bg-[#f1f5f9]' : ''}
                            ${!isSelected && !isFocused ? 'hover:bg-[#f8fafc]' : ''}
                          `}
                          role="option"
                          aria-selected={isSelected}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-xs font-medium truncate ${isSelected ? 'text-[#1d4ed8]' : 'text-[#0f172a]'}`}>
                                  {style.title}
                                </span>
                                {isSelected && (
                                  <svg className="w-3 h-3 text-primary-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                )}
                                {style.isCommon && (
                                  <span className="px-1 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-medium rounded flex-shrink-0">
                                    Popular
                                  </span>
                                )}
                              </div>
                              {style.fields && style.fields.length > 0 && (
                                <p className="text-[10px] text-[#64748b] mt-0.5 truncate">
                                  {style.fields.slice(0, 3).map(f => f.replace(/-/g, ' ')).join(', ')}
                              </p>
                              )}
                            </div>
                            {!hideExample ? (
                              <span className="text-[10px] font-mono text-[#94a3b8] bg-[#f1f5f9] px-1 py-0.5 rounded flex-shrink-0">
                                {getExampleCitation(style)}
                              </span>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}

              {/* No Results */}
              {displayStyles.length === 0 && (
                <li className="px-3 py-6 text-center">
                  {isSearching ? (
                    <>
                      <svg className="w-6 h-6 mx-auto text-primary-400 animate-spin mb-2" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <p className="text-xs text-[#64748b]">Searching styles...</p>
                    </>
                  ) : (
                    <>
                  <svg className="w-8 h-8 mx-auto text-[#cbd5e1] mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} 
                          d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs text-[#64748b]">No citation styles found</p>
                      <p className="text-[10px] text-[#94a3b8] mt-1">
                        Try enabling &quot;Search all CSL styles&quot; above
                      </p>
                    </>
                  )}
                </li>
              )}
            </ul>

            {/* Footer */}
            <div className="px-2 py-1.5 bg-[#f8fafc] border-t border-[#f1f5f9]">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-[#94a3b8]">
                  {displayStyles.length} style{displayStyles.length !== 1 ? 's' : ''} shown
                </p>
                <a 
                  href="https://github.com/citation-style-language/styles" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-[10px] text-primary-600 hover:text-primary-700 flex items-center gap-1"
                >
                  <span>CSL Repo</span>
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CitationStyleSelector;
