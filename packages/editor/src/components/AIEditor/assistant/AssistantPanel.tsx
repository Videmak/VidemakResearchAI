'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LuX } from 'react-icons/lu';

export type AssistantTab = 'chat' | 'comments' | 'review' | 'library' | 'papers';

const LABELS: Record<AssistantTab, string> = { chat: 'Chat', comments: 'Comments', review: 'Review', library: 'Library', papers: 'Papers' };
const TITLES: Record<AssistantTab, string> = { chat: 'AI Chat', comments: 'Comments', review: 'Review', library: 'Library', papers: 'Find papers' };
// The mockups order the tabs differently on desktop and in the phone sheet.
const DESKTOP_ORDER: AssistantTab[] = ['chat', 'comments', 'review', 'library', 'papers'];
const PHONE_ORDER: AssistantTab[] = ['chat', 'comments', 'review', 'papers', 'library'];

/**
 * One panel beside the document for AI Chat, Comments, Library and Find papers (desktop:
 * a 392px column on the right; phone: a bottom sheet over the document). Panels stay
 * mounted while it is open, so a chat or a search survives switching tabs.
 */
export default function AssistantPanel({
  tab,
  onTabChange,
  onClose,
  isMobile,
  commentCount,
  panels,
}: {
  tab: AssistantTab;
  onTabChange: (tab: AssistantTab) => void;
  onClose: () => void;
  isMobile: boolean;
  commentCount: number;
  panels: Record<AssistantTab, React.ReactNode>;
}) {
  // Escape closes the phone sheet. On wider screens the panel is a docked column that stays
  // open (Escape there belongs to menus and pop-ups); its own button closes it.
  useEffect(() => {
    if (!isMobile) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobile, onClose]);

  const tabs = (isMobile ? PHONE_ORDER : DESKTOP_ORDER).map((id) => {
    const selected = id === tab;
    return (
      <button
        key={id}
        role="tab"
        type="button"
        aria-selected={selected}
        onClick={() => onTabChange(id)}
        className={`inline-flex h-8 flex-auto items-center justify-center whitespace-nowrap rounded-lg px-2.5 text-[13.5px] transition-colors ${
          selected ? 'bg-[#eff6ff] font-semibold text-[var(--theme-primary-dark)]' : 'font-medium text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0f172a]'
        }`}
      >
        {LABELS[id]}
        {id === 'comments' && commentCount ? (
          <span className="ml-1.5 min-w-[17px] rounded-full bg-[#f59e0b] px-1 text-center text-[10.5px] font-semibold leading-[17px] text-white">
            {commentCount > 99 ? '99+' : commentCount}
          </span>
        ) : null}
      </button>
    );
  });

  const body = (
    <div className="relative min-h-0 flex-1">
      {DESKTOP_ORDER.map((id) => (
        <div key={id} role="tabpanel" aria-label={LABELS[id]} aria-hidden={id !== tab} className={id === tab ? 'absolute inset-0 flex flex-col bg-white' : 'hidden'}>
          {panels[id]}
        </div>
      ))}
    </div>
  );

  if (isMobile) {
    // A portal: the document area is its own stacking context, under the editor's app bar.
    return createPortal(
      <div className="fixed inset-0 z-[13000]" style={{ top: 'var(--app-banner-h, 0px)' }}>
        <button type="button" aria-label="Close panel" className="absolute inset-0 h-full w-full cursor-default bg-[rgba(15,23,42,.35)]" onClick={onClose} />
        <div
          role="dialog"
          aria-label="Assistant"
          className="ce-assistant-sheet absolute inset-x-0 bottom-0 flex h-[74%] flex-col rounded-t-[24px] bg-white shadow-[0_-10px_30px_-10px_rgba(15,23,42,.3)]"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <button type="button" onClick={onClose} aria-label="Close panel" className="mx-auto mb-1 mt-[9px] block h-[5px] w-[42px] shrink-0 rounded-full bg-[#cbd5e1]" />
          <div role="tablist" aria-label="Assistant" className="flex shrink-0 gap-1 border-b border-[#f1f5f9] px-3 pb-2 pt-1">
            {tabs}
          </div>
          {body}
        </div>
      </div>,
      document.body,
    );
  }

  // Desktop: the side rail switches tools, so the panel shows its title and a close button
  // (AI Chat draws its own bar, with history and new chat beside the close button).
  return (
    <aside className="ce-assistant-panel ai-editor-print-hidden flex h-full w-[380px] shrink-0 flex-col border-l lg:w-[clamp(320px,27vw,380px)] border-[#eef2f6] bg-white max-lg:absolute max-lg:bottom-0 max-lg:right-[52px] max-lg:top-0 max-lg:z-[11600] max-lg:shadow-[-16px_0_40px_-24px_rgba(15,23,42,.35)]">
      <div className={`${tab === 'chat' ? 'hidden' : 'flex'} h-[52px] shrink-0 items-center gap-2 border-b border-[#f1f5f9] pl-4 pr-2`}>
        <h2 className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-[#0f172a]">
          {TITLES[tab]}
          {tab === 'comments' && commentCount ? <span className="ml-1.5 font-medium text-[#94a3b8]">{commentCount}</span> : null}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          title="Close"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
        >
          <LuX className="h-[18px] w-[18px]" />
        </button>
      </div>
      {body}
    </aside>
  );
}
