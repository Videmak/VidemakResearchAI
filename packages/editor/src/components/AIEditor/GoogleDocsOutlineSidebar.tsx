'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LuBookmark, LuX } from 'react-icons/lu';

export type OutlineItem = {
  id: string;
  title: string;
  level: number;
};

type GoogleDocsOutlineSidebarProps = {
  outlineItems: OutlineItem[];
  bookmarkItems?: OutlineItem[];
  activeOutlineId: string | null;
  isPanelVisible: boolean;
  onShowPanel: () => void;
  onHidePanel: () => void;
  onSelectOutlineItem: (itemId: string) => void;
  /** Phones: the outline opens as a bottom sheet (from the ⋯ sheet); there is no page button. */
  isMobile?: boolean;
};

/**
 * The document outline: a small button at the top left of the page (as in the mockups)
 * that opens a quiet list of headings and bookmarks over the page.
 */
export default function GoogleDocsOutlineSidebar({
  outlineItems,
  bookmarkItems = [],
  activeOutlineId,
  isPanelVisible,
  onShowPanel,
  onHidePanel,
  onSelectOutlineItem,
  isMobile = false,
}: GoogleDocsOutlineSidebarProps) {
  useEffect(() => {
    if (!isPanelVisible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onHidePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPanelVisible, onHidePanel]);

  const list = (
    <>
      <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1">
        <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#94a3b8]">Outline</span>
        <button
          type="button"
          onClick={onHidePanel}
          aria-label="Hide document outline"
          className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
        >
          <LuX className="h-4 w-4" />
        </button>
      </div>
      {outlineItems.length > 0 || bookmarkItems.length > 0 ? (
        <div className="space-y-3">
          {outlineItems.length > 0 ? (
            <nav aria-label="Document outline" className="space-y-px">
              {outlineItems.map((item) => {
                const isActive = item.id === activeOutlineId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectOutlineItem(item.id)}
                    aria-current={isActive ? 'location' : undefined}
                    className={`flex w-full items-center rounded-[8px] py-1.5 pr-2.5 text-left text-[13.5px] leading-5 transition-colors ${
                      isActive
                        ? 'bg-[#eff6ff] font-medium text-[var(--theme-primary-dark)]'
                        : item.level <= 1
                          ? 'font-medium text-[#0f172a] hover:bg-[#f8fafc]'
                          : 'text-[#475569] hover:bg-[#f8fafc] hover:text-[#0f172a]'
                    }`}
                    style={{ paddingLeft: `${10 + Math.max(item.level - 1, 0) * 14}px` }}
                  >
                    <span className="truncate">{item.title}</span>
                  </button>
                );
              })}
            </nav>
          ) : null}

          {bookmarkItems.length > 0 ? (
            <div>
              <div className="px-2.5 pb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#94a3b8]">Bookmarks</div>
              <div className="space-y-px">
                {bookmarkItems.map((item) => {
                  const isActive = item.id === activeOutlineId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectOutlineItem(item.id)}
                      className={`flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[13.5px] transition-colors ${
                        isActive ? 'bg-[#eff6ff] text-[var(--theme-primary-dark)]' : 'text-[#475569] hover:bg-[#f8fafc] hover:text-[#0f172a]'
                      }`}
                    >
                      <LuBookmark className="h-4 w-4 shrink-0 text-[#94a3b8]" />
                      <span className="truncate">{item.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="px-2.5 pb-2 pt-1 text-[13px] leading-5 text-[#64748b]">
          Headings and bookmarks you add to the document appear here.
        </p>
      )}
    </>
  );

  if (isMobile) {
    if (!isPanelVisible || typeof document === 'undefined') return null;
    return createPortal(
      <div className="fixed inset-0 z-[12600]" role="dialog" aria-modal="true" aria-label="Document outline">
        <button type="button" aria-label="Close outline" className="absolute inset-0 h-full w-full cursor-default bg-[rgba(15,23,42,.35)]" onClick={onHidePanel} />
        <div className="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-[24px] bg-white px-3 pb-[calc(16px+env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_30px_-10px_rgba(15,23,42,.3)]">
          <div className="mx-auto mb-2 h-[5px] w-[42px] rounded-full bg-[#cbd5e1]" />
          {list}
        </div>
      </div>,
      document.body,
    );
  }

  // Desktop: the side rail's Outline button opens this card over the page's left margin.
  if (!isPanelVisible) return null;
  return (
    <aside className="ai-editor-print-hidden absolute left-4 top-4 z-30 max-h-[calc(100%-32px)] w-[264px] overflow-y-auto rounded-[14px] border border-[#e5e7eb] bg-white p-1.5 shadow-[0_22px_50px_-18px_rgba(15,23,42,.35)]">
      {list}
    </aside>
  );
}
