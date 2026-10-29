'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LuArrowRight, LuFileText, LuLayoutGrid, LuList, LuPlus, LuSearch, LuStar, LuUsers } from 'react-icons/lu';
import { getAIEditorProvider } from '../../../lib/aiEditor/getProvider';
import { closeSideloadDrawer } from '../../../lib/sideloads';
import { editorPath, useEditorConfig } from '../../../runtime';
import type { AIEditorDocumentSummary } from '../../../types/ai-editor';
import { DocumentPreview, relativeTime } from '../documentPreview';

type View = 'list' | 'grid';
const VIEW_KEY = 'videmak-docs-drawer-view';

export type DocumentsPanelProps = {
  /** The open document (highlighted). */
  activeDocumentId?: string | null;
  /** Defaults open /editor?doc=…, /editor?new=1 and /editor in the host app. */
  onOpenDocument?: (documentId: string) => void;
  onCreateDocument?: () => void;
  onOpenHome?: () => void;
  /** False while the panel waits hidden behind another tab; showing it again reloads the list. */
  visible?: boolean;
};

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

function readStarredIds(): Set<string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem('ai-editor-starred-documents') || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

const isShared = (document: AIEditorDocumentSummary) => document.memberCount > 0 || Boolean(document.share?.isLinkSharingEnabled);

/** Overlay drawers (tablets and phones) step aside once a document opens; the docked one stays. */
const closeIfOverlay = () => {
  if (window.innerWidth < 1024) closeSideloadDrawer();
};

/** The writer's documents in the left drawer, as a list or as thumbnails (like the Library drawer). */
export default function DocumentsPanel({ activeDocumentId, onOpenDocument, onCreateDocument, onOpenHome, visible = true }: DocumentsPanelProps) {
  const router = useRouter();
  const config = useEditorConfig();
  const signedOut = !config.user && !config.userLoading;
  const [documents, setDocuments] = useState<AIEditorDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('list');
  const [starred, setStarred] = useState<Set<string>>(new Set());

  useEffect(() => {
    setView(readView());
  }, []);

  // Subscribing refreshes the list from the server; the cached list shows straight away.
  useEffect(() => {
    if (!visible || signedOut) return undefined;
    setStarred(readStarredIds());
    let calls = 0;
    const done = window.setTimeout(() => setLoading(false), 6000);
    const unsubscribe = getAIEditorProvider().subscribeToDocuments((next) => {
      calls += 1;
      setDocuments(next);
      if (next.length > 0 || calls > 1) setLoading(false);
    });
    return () => {
      window.clearTimeout(done);
      unsubscribe();
    };
  }, [signedOut, visible]);

  const chooseView = (next: View) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* storage blocked: the choice lasts for this page */
    }
  };

  const open = (documentId: string) => {
    if (onOpenDocument) onOpenDocument(documentId);
    else router.push(`${editorPath()}?doc=${encodeURIComponent(documentId)}`);
    closeIfOverlay();
  };
  const create = () => {
    if (signedOut) {
      config.onRequireSignIn?.('write and save documents');
      return;
    }
    if (onCreateDocument) onCreateDocument();
    else router.push(`${editorPath()}?new=1`);
    closeIfOverlay();
  };
  const openHome = () => {
    closeSideloadDrawer();
    if (onOpenHome) onOpenHome();
    else router.push(editorPath());
  };

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...documents]
      .filter((document) => !needle || (document.title || 'Untitled document').toLowerCase().includes(needle))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [documents, query]);

  const meta = (document: AIEditorDocumentSummary) =>
    `Edited ${relativeTime(document.updatedAt)}${typeof document.wordCount === 'number' ? ` · ${document.wordCount.toLocaleString()} ${document.wordCount === 1 ? 'word' : 'words'}` : ''}`;
  const title = (document: AIEditorDocumentSummary) => (
    <>
      {starred.has(document.id) ? <LuStar className="mr-1 inline h-3 w-3 -translate-y-px fill-[#f59e0b] text-[#f59e0b]" aria-label="Starred" /> : null}
      {document.title || 'Untitled document'}
    </>
  );
  const sharedMark = (document: AIEditorDocumentSummary) =>
    isShared(document) ? <LuUsers className="h-3.5 w-3.5 shrink-0 text-[#94a3b8]" aria-label="Shared" /> : null;
  const viewButton = (value: View, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-pressed={view === value}
      aria-label={label}
      title={label}
      onClick={() => chooseView(value)}
      className={`grid h-7 w-7 place-items-center rounded-[7px] transition-colors ${view === value ? 'bg-white text-[#0f172a] shadow-[0_1px_2px_rgba(15,23,42,.12)]' : 'text-[#94a3b8] hover:text-[#0f172a]'}`}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="px-3 pt-3">
        <div className="flex items-center gap-1.5">
          <div className="group relative min-w-0 flex-1">
            <LuSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8] group-focus-within:text-[var(--theme-primary,#2563eb)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={documents.length ? `Search ${documents.length} document${documents.length === 1 ? '' : 's'}` : 'Search documents'}
              aria-label="Search your documents"
              className="h-9 w-full rounded-[10px] border border-[#e2e8f0] bg-white pl-9 pr-3 text-[14px] text-[#0f172a] outline-none transition-[border,box-shadow] placeholder:text-[#94a3b8] focus:border-[var(--theme-primary,#2563eb)] focus:shadow-[0_0_0_3px_#eff6ff]"
            />
          </div>
          <button
            type="button"
            onClick={create}
            aria-label="New document"
            title="New document"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-[#eff6ff] px-3 text-[13px] font-semibold text-[#1d4ed8] transition-colors hover:bg-[#dbeafe]"
          >
            <LuPlus className="h-4 w-4" />
            New
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between border-b border-[#f1f5f9] px-1 pb-2">
          <span className="text-[12.5px] font-medium text-[#64748b]">{query.trim() ? `${shown.length} found` : 'Recent'}</span>
          <div role="group" aria-label="View" className="inline-flex rounded-[9px] bg-[#f1f5f9] p-0.5">
            {viewButton('list', 'List view', <LuList className="h-4 w-4" />)}
            {viewButton('grid', 'Thumbnail view', <LuLayoutGrid className="h-4 w-4" />)}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2">
        {signedOut ? (
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <LuFileText className="h-7 w-7 text-[#cbd5e1]" />
            <p className="mt-2 text-[14px] font-semibold text-[#0f172a]">Sign in to see your documents</p>
            <button
              type="button"
              onClick={() => config.onRequireSignIn?.('see your documents')}
              className="mt-3 h-9 rounded-[10px] bg-[var(--theme-primary,#2563eb)] px-3.5 text-[13.5px] font-semibold text-white hover:bg-[var(--theme-primary-dark,#1d4ed8)]"
            >
              Sign in
            </button>
          </div>
        ) : loading && documents.length === 0 ? (
          <div className={view === 'grid' ? 'grid grid-cols-2 gap-2.5' : 'space-y-1.5'} role="status" aria-label="Loading documents">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className={`animate-pulse rounded-[12px] bg-[#f8fafc] ${view === 'grid' ? 'h-[168px]' : 'h-[52px]'}`} />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <LuFileText className="h-7 w-7 text-[#cbd5e1]" />
            <p className="mt-2 text-[14px] font-semibold text-[#0f172a]">No documents yet</p>
            <button
              type="button"
              onClick={create}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-[var(--theme-primary,#2563eb)] px-3.5 text-[13.5px] font-semibold text-white hover:bg-[var(--theme-primary-dark,#1d4ed8)]"
            >
              <LuPlus className="h-4 w-4" />
              New document
            </button>
          </div>
        ) : shown.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13.5px] text-[#64748b]">No documents match “{query.trim()}”</p>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-2 gap-2.5">
            {shown.map((document) => {
              const active = document.id === activeDocumentId;
              return (
                <button
                  key={document.id}
                  type="button"
                  onClick={() => open(document.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`group block min-w-0 overflow-hidden rounded-[12px] border bg-white text-left transition-shadow hover:shadow-[0_10px_24px_-16px_rgba(15,23,42,.4)] ${
                    active ? 'border-[var(--theme-primary,#2563eb)] ring-2 ring-[#dbeafe]' : 'border-[#e5e7eb]'
                  }`}
                >
                  <DocumentPreview document={document} small />
                  <span className="block px-2.5 py-2">
                    <span className="flex items-center gap-1">
                      <b className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#0f172a]">{title(document)}</b>
                      {sharedMark(document)}
                    </span>
                    <span className="block truncate text-[11.5px] text-[#64748b]">{relativeTime(document.updatedAt)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {shown.map((document) => {
              const active = document.id === activeDocumentId;
              return (
                <li key={document.id}>
                  <button
                    type="button"
                    onClick={() => open(document.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex min-h-[52px] w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors ${active ? 'bg-[#eff6ff]' : 'hover:bg-[#f8fafc]'}`}
                  >
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[9px] ${active ? 'bg-white text-[var(--theme-primary,#2563eb)]' : 'bg-[#f1f5f9] text-[#64748b]'}`}>
                      <LuFileText className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-[#0f172a]">{title(document)}</span>
                      <span className="block truncate text-[12px] text-[#64748b]">{meta(document)}</span>
                    </span>
                    {sharedMark(document)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!signedOut ? (
        <div className="shrink-0 border-t border-[#f1f5f9] px-3 py-2">
          <button
            type="button"
            onClick={openHome}
            className="flex h-9 w-full items-center justify-between rounded-[10px] px-2 text-[13.5px] font-medium text-[#334155] transition-colors hover:bg-[#f8fafc] hover:text-[#0f172a]"
          >
            All documents
            <LuArrowRight className="h-4 w-4 text-[#94a3b8]" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
