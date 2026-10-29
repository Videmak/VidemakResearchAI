'use client';

import { useEffect, useState } from 'react';
import type React from 'react';
import type { BlockNoteEditor } from '@blocknote/core';
import { LuMinus, LuPlus } from 'react-icons/lu';
import CitationStyleSelector from '../ResearchAgent/CitationStyleSelector';

type EditorStatusBarProps = {
  surfaceRef: React.RefObject<HTMLElement | null>;
  editor: BlockNoteEditor<any, any, any>;
  pageWidthPx: number;
  zoomValue: string;
  zoomPercentage: number;
  onZoomChange: (value: string) => void;
  citationStyle: string;
  onCitationStyleChange: (styleId: string) => void;
  savedLabel: string;
  /** Pages from the print layout; estimated from the text height otherwise. */
  pageCount?: number;
};

function countWords(text: string) {
  const words = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return words ? words.length : 0;
}

const ZOOM_STEPS = [50, 75, 90, 100, 125, 150, 200];

/**
 * The status bar under the document (tablet and desktop), as in Docs:
 * pages, words (or "12 of 412 words" with a selection), the citation style, the save
 * state and the zoom.
 */
export default function EditorStatusBar({
  surfaceRef,
  editor,
  pageWidthPx,
  zoomValue,
  zoomPercentage,
  onZoomChange,
  citationStyle,
  onCitationStyleChange,
  savedLabel,
  pageCount,
}: EditorStatusBarProps) {
  const [stats, setStats] = useState({ words: 0, pages: 1 });
  // Counted here, not in the workspace, so typing doesn't re-render the whole editor.
  const [revision, setRevision] = useState(0);
  useEffect(() => editor.onChange(() => setRevision((value) => value + 1)), [editor]);
  // "12 of 1,234 words" while text is selected, as in Docs.
  const [selectedWords, setSelectedWords] = useState(0);
  useEffect(
    () =>
      editor.onSelectionChange(() => {
        let text = '';
        try {
          text = editor.getSelectedText();
        } catch {
          text = '';
        }
        const words = countWords(text);
        setSelectedWords((current) => (current === words ? current : words));
      }),
    [editor],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const surface = surfaceRef.current;
      const content = surface?.querySelector<HTMLElement>('.bn-editor');
      if (!content) return;
      // Letter/A4 proportions at the current page width (unzoomed layout height).
      const pageHeight = pageWidthPx * (11 / 8.5);
      const pages = Math.max(1, Math.ceil(content.offsetHeight / pageHeight));
      // Autocomplete ghost text is on screen but not in the document.
      const ghost = content.querySelector('.ce-ghost-text')?.textContent || '';
      const words = Math.max(0, countWords(content.innerText || '') - countWords(ghost));
      setStats((current) => (current.words === words && current.pages === pages ? current : { words, pages }));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [pageWidthPx, revision, surfaceRef]);

  const pages = pageCount ?? stats.pages;
  const wordsLabel = `${selectedWords ? `${selectedWords.toLocaleString()} of ` : ''}${stats.words.toLocaleString()} ${stats.words === 1 ? 'word' : 'words'}`;
  const saved = /^saved/i.test(savedLabel);

  const stepZoom = (direction: 1 | -1) => {
    const next = direction > 0
      ? ZOOM_STEPS.find((step) => step > zoomPercentage)
      : [...ZOOM_STEPS].reverse().find((step) => step < zoomPercentage);
    if (next) onZoomChange(`${next}%`);
  };

  return (
    // No overflow clipping here: the citation style list opens upwards out of this bar.
    <div className="ai-editor-print-hidden relative z-20 hidden h-9 shrink-0 items-center gap-1 whitespace-nowrap border-t border-[#f1f5f9] bg-white px-3 text-[12.5px] text-[#64748b] md:flex">
      <span className="px-1.5">{pages} {pages === 1 ? 'page' : 'pages'}</span>
      <span className="px-1.5">{wordsLabel}</span>
      <CitationStyleSelector
        selectedStyle={citationStyle}
        onStyleChange={onCitationStyleChange}
        className="shrink-0"
        triggerClassName="!h-7 !gap-1 !rounded-md !border-0 !bg-transparent !px-1.5 !py-0 hover:!bg-[#f1f5f9] [&>span]:!text-[12.5px] [&>span]:!font-medium [&>span]:!text-[#475569]"
        dropdownClassName="!w-[400px] !max-w-[calc(100vw-24px)] !z-[12020] !bottom-full !top-auto !left-0 !right-auto !mb-1"
        hideExample={false}
      />
      <div className="ml-auto flex items-center gap-1">
        <span className="inline-flex items-center gap-1.5 px-1.5" title={savedLabel}>
          <i className={`h-[7px] w-[7px] rounded-full ${saved ? 'bg-[#22c55e]' : /fail|error/i.test(savedLabel) ? 'bg-[#ef4444]' : 'bg-[#f59e0b]'}`} aria-hidden="true" />
          {saved ? 'Saved' : savedLabel.replace(/ to server/i, '')}
        </span>
        <span className="mx-1 h-4 w-px bg-[#e5e7eb]" aria-hidden="true" />
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => stepZoom(-1)} className="grid h-7 w-7 place-items-center rounded-md hover:bg-[#f1f5f9] hover:text-[#0f172a]">
          <LuMinus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onZoomChange(zoomValue === 'Fit' ? '100%' : 'Fit')}
          title={zoomValue === 'Fit' ? 'Fitting the page to the window. Click for 100%.' : 'Fit the page to the window'}
          className="h-7 min-w-[64px] rounded-md px-1.5 text-center hover:bg-[#f1f5f9] hover:text-[#0f172a]"
        >
          {zoomValue === 'Fit' ? `Fit (${zoomPercentage}%)` : `${zoomPercentage}%`}
        </button>
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => stepZoom(1)} className="grid h-7 w-7 place-items-center rounded-md hover:bg-[#f1f5f9] hover:text-[#0f172a]">
          <LuPlus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
