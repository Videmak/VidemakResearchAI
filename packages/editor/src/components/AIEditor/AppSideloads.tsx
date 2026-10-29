'use client';

import React, { useEffect, useState } from 'react';
import { LuPanelLeftClose, LuPanelLeftOpen, LuX } from 'react-icons/lu';
import LibraryPanel from './assistant/LibraryPanel';
import FindPapersPanel, { type ParagraphTarget } from './assistant/FindPapersPanel';
import ChatPanel from './assistant/ChatPanel';
import DocumentsPanel, { type DocumentsPanelProps } from './assistant/DocumentsPanel';
import {
  closeSideloadChat,
  closeSideloadDrawer,
  setSideloadMenu,
  setSideloadMentions,
  showSideload,
  useSideloads,
  type SideloadDrawer,
} from '../../lib/sideloads';
import type { Paper } from '../../lib/aiEditor/assistApi';
import type { LibraryDocumentResponse } from '../../utils/libraryApi';

const DRAWERS: { id: SideloadDrawer; label: string }[] = [
  { id: 'documents', label: 'Documents' },
  { id: 'library', label: 'Library' },
  { id: 'papers', label: 'Find papers' },
];

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Stays mounted after the first open, so a search or a chat survives closing and reopening. */
function useOpenedOnce(open: boolean) {
  const [opened, setOpened] = useState(open);
  useEffect(() => {
    if (open) setOpened(true);
  }, [open]);
  return opened || open;
}

const iconButton = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#94a3b8] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]';
const backdrop = 'fixed inset-0 z-[12990] hidden h-full w-full cursor-default bg-[rgba(15,23,42,.35)] sm:block lg:hidden';

type ToolDrawerProps = {
  /** Docked placement on wide screens (default: fills the height of a flex row). */
  className?: string;
  /** In the editor: its own open / new / home actions. Elsewhere documents open through the editor route. */
  documents?: Omit<DocumentsPanelProps, 'visible'>;
  /** In an open document: cite into it and ask in its chat. Elsewhere the drawer copies references. */
  library?: { onCite?: (document: LibraryDocumentResponse) => void; onAsk?: (document: LibraryDocumentResponse) => void; citing?: boolean };
  papers?: {
    onCite?: (paper: Paper, paragraph: ParagraphTarget | null) => void;
    onSave?: (paper: Paper) => Promise<boolean>;
    savedKeys?: Set<string>;
    suggestedQueries?: string[];
    documentTitle?: string;
  };
};

/**
 * Documents, Library and Find papers slide in from the left in place of the app menu: wide
 * screens dock the drawer (the menu can be shown beside it), tablets lay it over the page and
 * phones give it the whole screen.
 */
export function AppToolDrawer({ className = 'lg:relative lg:h-full', documents, library, papers }: ToolDrawerProps) {
  const { drawer, menu } = useSideloads();
  const mounted = useOpenedOnce(Boolean(drawer));
  const isPhone = useMediaQuery('(max-width: 767px)');
  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && window.innerWidth < 1024) closeSideloadDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);
  if (!mounted) return null;

  return (
    <>
      {drawer ? <button type="button" aria-label="Close panel" className={backdrop} onClick={closeSideloadDrawer} /> : null}
      <aside
        aria-label={DRAWERS.find((item) => item.id === drawer)?.label ?? 'Library'}
        className={`ce-tool-drawer ai-editor-print-hidden fixed inset-0 z-[13000] flex-col bg-white sm:right-auto sm:w-[380px] sm:shadow-[16px_0_40px_-24px_rgba(15,23,42,.35)] lg:z-auto lg:w-[clamp(300px,26vw,360px)] lg:shrink-0 lg:border-r lg:border-[#e5e7eb] lg:shadow-none ${className} ${drawer ? 'flex' : 'hidden'}`}
      >
        <div className="flex h-[52px] shrink-0 items-center gap-1 border-b border-[#f1f5f9] px-2">
          <button
            type="button"
            onClick={() => setSideloadMenu(!menu)}
            aria-label={menu ? 'Hide menu' : 'Show menu'}
            title={menu ? 'Hide menu' : 'Show menu'}
            className={`${iconButton} hidden xl:grid`}
          >
            {menu ? <LuPanelLeftClose className="h-[18px] w-[18px]" /> : <LuPanelLeftOpen className="h-[18px] w-[18px]" />}
          </button>
          <div role="tablist" aria-label="Writing tools" className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto pl-1 [scrollbar-width:none] lg:pl-0">
            {DRAWERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={drawer === item.id}
                onClick={() => showSideload(item.id)}
                className={`h-8 shrink-0 whitespace-nowrap rounded-lg px-2 text-[14px] transition-colors ${
                  drawer === item.id ? 'bg-[#eff6ff] font-semibold text-[var(--theme-primary-dark,#1d4ed8)]' : 'font-medium text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0f172a]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={closeSideloadDrawer} aria-label="Close panel" title="Close" className={iconButton}>
            <LuX className="h-[18px] w-[18px]" />
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          <div role="tabpanel" aria-label="Documents" className={drawer === 'documents' ? 'absolute inset-0 flex flex-col' : 'hidden'}>
            <DocumentsPanel {...documents} visible={drawer === 'documents'} />
          </div>
          <div role="tabpanel" aria-label="Library" className={drawer === 'library' ? 'absolute inset-0 flex flex-col' : 'hidden'}>
            <LibraryPanel onCite={library?.onCite} onAsk={library?.onAsk} citing={library?.citing} visible={drawer === 'library'} />
          </div>
          <div role="tabpanel" aria-label="Find papers" className={drawer === 'papers' ? 'absolute inset-0 flex flex-col' : 'hidden'}>
            <FindPapersPanel
              onCite={papers?.onCite}
              onSave={papers?.onSave}
              savedKeys={papers?.savedKeys}
              suggestedQueries={papers?.suggestedQueries}
              documentTitle={papers?.documentTitle}
              isMobile={isPhone}
            />
          </div>
        </div>
      </aside>
    </>
  );
}

/** The app's AI Chat on the right, outside a document (web and Library sources). */
export function AppChatSideload({ className = 'lg:relative lg:h-full' }: { className?: string }) {
  const { chat, mentions } = useSideloads();
  const mounted = useOpenedOnce(chat);
  const isPhone = useMediaQuery('(max-width: 767px)');
  if (!mounted) return null;
  return (
    <>
      {chat ? <button type="button" aria-label="Close chat" className={backdrop} onClick={closeSideloadChat} /> : null}
      <aside
        aria-label="AI Chat"
        className={`ce-chat-sideload ai-editor-print-hidden fixed inset-0 z-[13000] flex-col bg-white sm:left-auto sm:w-[400px] sm:shadow-[-16px_0_40px_-24px_rgba(15,23,42,.35)] lg:z-auto lg:w-[clamp(320px,28vw,400px)] lg:shrink-0 lg:border-l lg:border-[#e5e7eb] lg:shadow-none ${className} ${chat ? 'flex' : 'hidden'}`}
      >
        <ChatPanel documentId={null} mentions={mentions} onMentionsChange={setSideloadMentions} onClose={closeSideloadChat} isMobile={isPhone} />
      </aside>
    </>
  );
}
