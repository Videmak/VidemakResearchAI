'use client';

import { LuPanelLeftClose } from 'react-icons/lu';
import type React from 'react';
import { navLink, useEditorConfig } from '../../runtime';
import { isPaidPlan, useEditorAccount } from '../../lib/aiEditor/account';
import { toggleSideload, useSideloads, type SideloadTool } from '../../lib/sideloads';

const icon = (paths: React.ReactNode) => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths}
  </svg>
);

export const NAV_ICONS = {
  new: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>),
  docs: icon(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>),
  library: icon(<path d="M4 19V5M8 19V5M12 19l4-14 4 14" />),
  papers: icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  chat: icon(<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.6A8 8 0 1 1 21 12z" />),
  keys: icon(<><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2 2M14 9l2 2" /></>),
  admin: icon(<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z" />),
  help: icon(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17h.01" /></>),
};

/** The Videmak wordmark: a blue "V" tile and the name (same as the host app's logo). */
export function VidemakLogo({ size = 32 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5 font-extrabold tracking-[-0.02em] text-[#0f172a]" style={{ fontSize: Math.round(size * 0.66) }}>
      <span
        className="grid shrink-0 place-items-center rounded-[9px] bg-gradient-to-br from-[#3b82f6] to-[#1d4ed8] shadow-[0_4px_12px_-4px_rgba(37,99,235,.6)]"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" width={size * 0.56} height={size * 0.56} fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 5l7 14 7-14" />
          <path d="M12 19l2.5-5" />
        </svg>
      </span>
      <span>videmak</span>
    </span>
  );
}

type EditorAppNavProps = {
  recentDocuments: { id: string; title: string }[];
  activeDocumentId?: string | null;
  onCreateDocument: () => void;
  onOpenDocument: (documentId: string) => void;
  className?: string;
  /** Folds the nav away; the editor's header menu button brings it back. */
  onCollapse?: () => void;
  /**
   * Library and Find papers slide in from the left and AI Chat opens on the right, never as
   * separate pages. In an open document AI Chat is the document's own chat (it reads the page).
   */
  onOpenChat?: () => void;
  chatActive?: boolean;
  /** Called after a tool opens (the tablet menu closes itself). */
  onToolOpened?: () => void;
};

const itemClass = 'flex h-10 w-full items-center gap-[11px] rounded-[10px] px-2.5 text-left text-[15px] font-medium';
const itemIdle = 'text-[#334155] hover:bg-white/70';
const itemOn = 'bg-white text-[#0f172a] shadow-[0_1px_2px_rgba(15,23,42,.06),0_0_0_1px_#e5e7eb]';

/**
 * The app's left navigation from the mockups (232px, soft grey): New document, Documents,
 * Library, Find papers, AI Chat, recent documents, help, the plan card and the person.
 * A host that passes `renderNavigation` replaces it with its own.
 */
export default function EditorAppNav({ recentDocuments, activeDocumentId, onCreateDocument, onOpenDocument, onCollapse, onOpenChat, chatActive, onToolOpened, className = '' }: EditorAppNavProps) {
  const config = useEditorConfig();
  const account = useEditorAccount(Boolean(config.user));
  const sideloads = useSideloads();
  if (config.renderNavigation) {
    return <div className={`shrink-0 ${className}`}>{config.renderNavigation()}</div>;
  }
  const name = account?.name || config.user?.full_name || config.user?.email?.split('@')[0] || '';
  const showPlan = Boolean(account) && !isPaidPlan(account?.plan);
  const toolActive = (tool: SideloadTool) => (tool === 'chat' ? chatActive ?? sideloads.chat : sideloads.drawer === tool);
  const openTool = (tool: SideloadTool) => {
    if (tool === 'chat' && onOpenChat) onOpenChat();
    else toggleSideload(tool);
    onToolOpened?.();
  };
  const upgrade = () => {
    if (config.onUpgrade) config.onUpgrade({ reason: 'nav' });
    else window.location.assign(navLink('pricing'));
  };

  return (
    <aside
      aria-label="App"
      className={`ai-editor-print-hidden h-full w-[232px] shrink-0 flex-col overflow-y-auto border-r border-[#e5e7eb] bg-[#f8fafc] px-3 pb-3 pt-4 ${className}`}
    >
      <div className="flex items-start justify-between pb-[18px] pl-2">
        <a href={navLink('home')} className="block" aria-label="Videmak home">
          <VidemakLogo size={32} />
        </a>
        {onCollapse ? (
          <button type="button" onClick={onCollapse} aria-label="Hide menu" title="Hide menu" className="grid h-8 w-8 place-items-center rounded-lg text-[#94a3b8] transition-colors hover:bg-white hover:text-[#0f172a]">
            <LuPanelLeftClose className="h-[18px] w-[18px]" />
          </button>
        ) : null}
      </div>
      <button type="button" onClick={onCreateDocument} className={`${itemClass} font-semibold text-[var(--theme-primary)] hover:bg-white/70`}>
        {NAV_ICONS.new}New document
      </button>
      {/* Documents slides in like Library; it stays selected inside the editor unless another tool is open. */}
      <button
        type="button"
        onClick={() => openTool('documents')}
        aria-pressed={toolActive('documents')}
        className={`${itemClass} ${toolActive('documents') || !(['library', 'papers', 'chat'] as const).some(toolActive) ? itemOn : itemIdle}`}
      >
        {NAV_ICONS.docs}Documents<span className="ml-auto text-[#94a3b8]">›</span>
      </button>
      {([
        ['library', 'Library', NAV_ICONS.library],
        ['papers', 'Find papers', NAV_ICONS.papers],
        ['chat', 'AI Chat', NAV_ICONS.chat],
      ] as const).map(([tool, label, icon]) => (
        <button key={tool} type="button" onClick={() => openTool(tool)} aria-pressed={toolActive(tool)} className={`${itemClass} ${toolActive(tool) ? itemOn : itemIdle}`}>
          {icon}{label}{tool === 'library' ? <span className="ml-auto text-[#94a3b8]">›</span> : null}
        </button>
      ))}
      {recentDocuments.length > 0 ? (
        <>
          <p className="px-2.5 pb-1 pt-5 text-[12px] font-medium text-[#94a3b8]">Recent</p>
          {recentDocuments.slice(0, 3).map((document) => (
            <button
              key={document.id}
              type="button"
              onClick={() => onOpenDocument(document.id)}
              aria-current={document.id === activeDocumentId ? 'page' : undefined}
              className={`block h-[34px] w-full shrink-0 truncate rounded-[10px] px-2.5 text-left text-[14px] leading-[34px] hover:bg-white/70 ${
                document.id === activeDocumentId ? 'font-medium text-[#0f172a]' : 'text-[#334155]'
              }`}
            >
              {document.title || 'Untitled document'}
            </button>
          ))}
        </>
      ) : null}

      <div className="min-h-4 flex-1" />
      <a href={navLink('account')} className={`${itemClass} ${itemIdle}`}>{NAV_ICONS.keys}Account</a>
      {account?.isAdmin ? <a href={navLink('admin')} className={`${itemClass} ${itemIdle}`}>{NAV_ICONS.admin}Admin</a> : null}
      <a href={navLink('help')} className={`${itemClass} ${itemIdle}`}>{NAV_ICONS.help}Help</a>
      {showPlan ? (
        <div className="mt-2 flex shrink-0 items-center justify-between rounded-[10px] bg-white/70 px-2.5 py-2">
          <span className="text-[13px] text-[#64748b]">Free plan</span>
          <button type="button" onClick={upgrade} className="text-[13px] font-semibold text-[var(--theme-primary)] hover:underline">Upgrade</button>
        </div>
      ) : null}
      <a href={navLink('account')} className="flex shrink-0 items-center gap-2.5 px-2 pb-0.5 pt-3 text-[14px] font-medium text-[#0f172a]">
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#fde68a] to-[#fb923c] text-[13px] font-bold text-[#7c2d12]">
          {(name[0] || '·').toUpperCase()}
        </span>
        <span className="truncate">{name || 'Account'}</span>
      </a>
    </aside>
  );
}
