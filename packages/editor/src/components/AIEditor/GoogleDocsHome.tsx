'use client';
import { editorConfirm, editorPrompt } from '../../lib/aiEditor/editorDialogs';
import { toast } from 'react-hot-toast';
import { navLink, useEditorConfig } from '../../runtime';
import { isPaidPlan, useEditorAccount } from '../../lib/aiEditor/account';
import { DOCUMENT_TEMPLATES } from '../../lib/aiEditor/templates';
import { VidemakLogo } from './EditorAppNav';
import { DocumentPreview, relativeTime } from './documentPreview';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AIEditorDocumentSummary } from '../../types/ai-editor';

type GoogleDocsHomeProps = {
  // Signed-out visitors see the same page; create buttons say they lead to sign-in.
  signedIn?: boolean;
  ownedDocuments: AIEditorDocumentSummary[];
  sharedDocuments: AIEditorDocumentSummary[];
  onCreateDocument: () => void;
  /** A new document from one of the starting points (literature review, proposal, essay). */
  onCreateFromTemplate?: (templateId: string) => void;
  /** Word engine: open a .docx (or .doc, .odt, .rtf, .txt, .md, .pdf) as a new document. */
  onImportFile?: (file: File) => void;
  onOpenDocument: (documentId: string) => void;
  onDeleteDocument: (documentId: string) => Promise<void>;
  onRenameDocument: (documentId: string, title: string) => Promise<void>;
};

type DocsHomeView = 'grid' | 'list';
type DocsHomeFilter = 'all' | 'owned' | 'shared';

type HomeDocumentItem = AIEditorDocumentSummary & {
  source: 'owned' | 'shared';
  starred?: boolean;
};

/** Documents starred from the editor (File › Star) stay at the top of the list. */
function readStarredIds(): Set<string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem('ai-editor-starred-documents') || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

const STAR = (
  <svg viewBox="0 0 24 24" className="mr-1 inline h-[13px] w-[13px] -translate-y-px fill-[#f59e0b] text-[#f59e0b]" aria-label="Starred">
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
  </svg>
);

const WORD_ACCEPT =
  '.docx,.doc,.docm,.dotx,.dot,.odt,.rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword';

function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function greeting(name: string) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = name.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

const isShared = (document: HomeDocumentItem) =>
  document.source === 'shared' || document.memberCount > 0 || Boolean(document.share?.isLinkSharingEnabled);

function DocumentActionsMenu({
  document,
  isOpen,
  isDeleting,
  onToggle,
  onOpen,
  onRename,
  onDelete,
  className = '',
}: {
  document: HomeDocumentItem;
  isOpen: boolean;
  isDeleting: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  className?: string;
}) {
  return (
    <div className={`shrink-0 ${className.includes('absolute') ? '' : 'relative'} ${className}`} data-doc-actions-menu>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[#94a3b8] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]"
        aria-label={`More actions for ${document.title || 'Untitled document'}`}
        aria-expanded={isOpen}
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" />
        </svg>
      </button>

      {isOpen ? (
        <div
          role="menu"
          aria-label={`Actions for ${document.title || 'Untitled document'}`}
          className="absolute right-0 top-9 z-20 min-w-[180px] overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white p-1 shadow-[0_22px_50px_-18px_rgba(15,23,42,.35)]"
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={onOpen} className="flex w-full items-center rounded-[8px] px-3 py-2 text-left text-[13.5px] text-[#0f172a] hover:bg-[#f1f5f9]">
            Open
          </button>
          {document.source === 'owned' ? (
            <button type="button" role="menuitem" onClick={onRename} className="flex w-full items-center rounded-[8px] px-3 py-2 text-left text-[13.5px] text-[#0f172a] hover:bg-[#f1f5f9]">
              Rename
            </button>
          ) : null}
          {document.source === 'owned' ? (
            <button
              type="button"
              role="menuitem"
              onClick={onDelete}
              disabled={isDeleting}
              className="flex w-full items-center rounded-[8px] px-3 py-2 text-left text-[13.5px] text-[#b91c1c] hover:bg-[#fef2f2] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const searchIcon = (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
  </svg>
);

export default function GoogleDocsHome({
  signedIn = true,
  ownedDocuments,
  sharedDocuments,
  onCreateDocument,
  onCreateFromTemplate,
  onImportFile,
  onOpenDocument,
  onDeleteDocument,
  onRenameDocument,
}: GoogleDocsHomeProps) {
  const config = useEditorConfig();
  const account = useEditorAccount(Boolean(config.user));
  const [query, setQuery] = useState('');
  const [view, setView] = useState<DocsHomeView>(() => {
    try {
      return window.localStorage.getItem('videmak-docs-view') === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const [filter, setFilter] = useState<DocsHomeFilter>('all');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const layout = useHomeLayout(rootRef);
  const phone = layout === 'phone';
  // Narrow and compact share the header and the list; narrow shows the start tiles as a row.
  const tight = layout === 'narrow' || layout === 'compact';

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[data-doc-actions-menu]')) return;
      setOpenMenuId(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuId(null);
      // ⌘K / Ctrl+K: search your documents.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  const [starred, setStarred] = useState<Set<string>>(() => new Set());
  useEffect(() => setStarred(readStarredIds()), [ownedDocuments, sharedDocuments]);
  const documents = useMemo<HomeDocumentItem[]>(() => {
    const ownedIds = new Set(ownedDocuments.map((document) => document.id));
    const normalizedQuery = query.trim().toLowerCase();

    return [
      ...ownedDocuments.map((document) => ({ ...document, source: 'owned' as const })),
      ...sharedDocuments
        .filter((document) => !ownedIds.has(document.id))
        .map((document) => ({ ...document, source: 'shared' as const })),
    ]
      .filter((document) => {
        if (filter !== 'all' && document.source !== filter) return false;
        if (!normalizedQuery) return true;
        return (document.title || 'Untitled document').toLowerCase().includes(normalizedQuery);
      })
      .map((document) => ({ ...document, starred: starred.has(document.id) }))
      .sort((a, b) => Number(b.starred) - Number(a.starred) || b.updatedAt - a.updatedAt);
  }, [filter, ownedDocuments, query, sharedDocuments, starred]);

  const changeView = (next: DocsHomeView) => {
    setView(next);
    try {
      window.localStorage.setItem('videmak-docs-view', next);
    } catch {
      /* private mode */
    }
  };

  const handleDelete = async (document: HomeDocumentItem) => {
    if (document.source !== 'owned' || deletingId) return;
    const confirmed = await editorConfirm({ title: `Delete "${document.title || 'Untitled document'}"?`, message: 'The document and its comments are removed for everyone it is shared with.', okLabel: 'Delete', danger: true });
    if (!confirmed) return;
    try {
      setDeletingId(document.id);
      setOpenMenuId(null);
      await onDeleteDocument(document.id);
    } catch (error) {
      console.error('Failed to delete ai-editor document:', error);
      toast.error('Unable to delete this document right now.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleRename = async (document: HomeDocumentItem) => {
    if (document.source !== 'owned') return;
    const nextTitle = await editorPrompt({ title: 'Rename document', label: 'Name', defaultValue: document.title?.trim() || 'Untitled document', okLabel: 'Rename' });
    if (nextTitle === null) return;
    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle || trimmedTitle === (document.title?.trim() || 'Untitled document')) {
      setOpenMenuId(null);
      return;
    }
    try {
      setOpenMenuId(null);
      await onRenameDocument(document.id, trimmedTitle);
    } catch (error) {
      console.error('Failed to rename ai-editor document:', error);
      toast.error('Unable to rename this document right now.');
    }
  };

  const name = account?.name || config.user?.full_name || config.user?.email?.split('@')[0] || '';
  const showUpgrade = Boolean(account) && !isPaidPlan(account?.plan);
  const upgrade = () => {
    if (config.onUpgrade) config.onUpgrade({ reason: 'documents' });
    else window.location.assign(navLink('pricing'));
  };
  const menuFor = (document: HomeDocumentItem, className = '') => (
    <DocumentActionsMenu
      document={document}
      className={className}
      isOpen={openMenuId === document.id}
      isDeleting={deletingId === document.id}
      onToggle={() => setOpenMenuId((current) => (current === document.id ? null : document.id))}
      onOpen={() => onOpenDocument(document.id)}
      onRename={() => void handleRename(document)}
      onDelete={() => void handleDelete(document)}
    />
  );
  const wordsLabel = (document: HomeDocumentItem) =>
    typeof document.wordCount === 'number' ? `${document.wordCount.toLocaleString()} ${document.wordCount === 1 ? 'word' : 'words'}` : null;

  // Start tiles: Blank, Word, then the templates, drawn to fit the layout.
  type Start = { id: string; kind: 'blank' | 'word' | 'template'; name: string; short: string; description: string; tagline: string; index: number };
  const starts: Start[] = [
    { id: 'blank', kind: 'blank', name: signedIn ? 'Blank document' : 'Sign in to create', short: 'Blank', description: 'Start writing with AI beside you', tagline: 'Write with AI', index: 0 },
    ...(onImportFile && signedIn ? [{ id: 'word', kind: 'word' as const, name: 'Open a Word file', short: 'Open Word', description: '.docx, .doc, .odt — keeps your formatting', tagline: '.docx, .doc, .odt', index: 0 }] : []),
    ...(onCreateFromTemplate
      ? DOCUMENT_TEMPLATES.map((template, index) => ({ id: template.id, kind: 'template' as const, name: template.name, short: template.shortName, description: template.description, tagline: template.tagline, index }))
      : []),
  ];
  const startItem = (start: Start, className: string, children: React.ReactNode) =>
    start.kind === 'word' ? (
      <label key={start.id} className={`${className} cursor-pointer`}>
        <input
          type="file"
          className="sr-only"
          aria-label="Open a Word file"
          accept={WORD_ACCEPT}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onImportFile?.(file);
          }}
        />
        {children}
      </label>
    ) : (
      <button key={start.id} type="button" onClick={() => (start.kind === 'blank' ? onCreateDocument() : onCreateFromTemplate?.(start.id))} className={className}>
        {children}
      </button>
    );
  /** The tile's picture: a big +, the Word mark, or a page of grey lines. `icon` is the small square version. */
  const preview = (start: Start, size: 'icon' | 'phone' | 'medium' | 'wide') => {
    const box = {
      icon: 'h-10 w-10 shrink-0 rounded-[10px] border text-[15px]',
      phone: 'mb-2 h-[62px] rounded-[9px] text-[18px]',
      medium: 'h-[82px] w-full rounded-[12px] border text-[22px] transition-shadow group-hover:shadow-[0_8px_24px_-14px_rgba(15,23,42,.35)]',
      wide: 'mb-3 h-[120px] rounded-[10px] border text-[22px]',
    }[size];
    const kind = {
      blank: `border-[#dbeafe] ${size === 'icon' ? 'bg-white text-[22px]' : 'bg-[#eff6ff]'} font-light text-[var(--theme-primary)] ${size === 'medium' || size === 'wide' ? '!text-[34px]' : size === 'phone' ? '!text-[22px]' : ''}`,
      word: `border-dashed border-[#cbd5e1] bg-[#f8fafc] font-extrabold text-[#2b579a] ${size === 'wide' ? 'border-2' : ''}`,
      template: 'border-[#f1f5f9] bg-[#f8fafc] text-[var(--theme-primary)]',
    }[start.kind];
    const lines = start.kind === 'template' && (size === 'medium' || size === 'wide');
    return (
      <span className={`grid place-items-center ${box} ${kind} ${lines ? '!flex flex-col justify-start gap-[6px] px-3.5 py-3' : ''}`} aria-hidden="true">
        {start.kind === 'blank' ? '+' : start.kind === 'word' ? (size === 'icon' ? 'W' : 'W ⇪') : lines ? (
          <>
            <i className="h-[9px] w-[60%] rounded-full bg-[#cbd5e1]" />
            <i className="h-[6px] rounded-full bg-[#e2e8f0]" style={{ width: ['100%', '100%', '85%'][start.index] }} />
            <i className="h-[6px] rounded-full bg-[#e2e8f0]" style={{ width: ['100%', '80%', '100%'][start.index] }} />
            <i className="h-[6px] rounded-full bg-[#e2e8f0]" style={{ width: ['70%', '100%', '60%'][start.index] }} />
          </>
        ) : '≡'}
      </span>
    );
  };

  const filterButtons = (
    <>
      {(['all', 'owned', 'shared'] as DocsHomeFilter[]).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setFilter(option)}
          aria-pressed={filter === option}
          className={`inline-flex h-[30px] items-center whitespace-nowrap rounded-full border px-[11px] text-[13px] font-medium transition-colors ${
            filter === option ? 'border-[#dbeafe] bg-[#eff6ff] text-[var(--theme-primary-dark)]' : 'border-[#e5e7eb] bg-white text-[#334155] hover:bg-[#f8fafc]'
          }`}
        >
          {option === 'all' ? 'All' : option === 'owned' ? (layout === 'medium' ? 'Mine' : 'Owned by me') : layout === 'medium' ? 'Shared' : 'Shared with me'}
        </button>
      ))}
      <div className="ml-1 inline-flex rounded-full border border-[#e5e7eb] p-0.5" role="group" aria-label="View">
        {(['grid', 'list'] as DocsHomeView[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => changeView(option)}
            aria-label={option === 'grid' ? 'Grid view' : 'List view'}
            aria-pressed={view === option}
            className={`grid h-[24px] w-[28px] place-items-center rounded-full ${view === option ? 'bg-[#eff6ff] text-[var(--theme-primary-dark)]' : 'text-[#94a3b8] hover:text-[#0f172a]'}`}
          >
            <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {option === 'grid' ? (
                <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>
              ) : (
                <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
              )}
            </svg>
          </button>
        ))}
      </div>
    </>
  );
  // Narrow column: the filter is a small menu.
  const filterSelect = (
    <label className="relative inline-flex h-[30px] items-center rounded-full border border-[#e5e7eb] bg-white pl-[11px] pr-7 text-[13px] font-semibold text-[#334155]">
      <span className="sr-only">Show</span>
      <select value={filter} onChange={(event) => setFilter(event.target.value as DocsHomeFilter)} className="cursor-pointer appearance-none bg-transparent outline-none">
        <option value="all">All</option>
        <option value="owned">Owned by me</option>
        <option value="shared">Shared with me</option>
      </select>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-2.5 h-[13px] w-[13px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </label>
  );

  const title = (document: HomeDocumentItem) => <>{document.starred ? STAR : null}{document.title || 'Untitled document'}</>;
  const searchBox = (className: string, inputClass: string, placeholder: string, shortcut: boolean) => (
    <label className={`flex items-center gap-2.5 border border-[#e5e7eb] bg-[#f8fafc] px-3.5 text-[#94a3b8] focus-within:border-[var(--theme-primary)] focus-within:bg-white focus-within:shadow-[0_0_0_4px_#eff6ff] ${className}`}>
      {searchIcon}
      <input
        ref={phone ? undefined : searchRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        aria-label="Search documents"
        className={`min-w-0 flex-1 bg-transparent text-[#0f172a] outline-none placeholder:text-[#94a3b8] ${inputClass}`}
      />
      {shortcut ? <span className="rounded-[5px] border border-b-2 border-[#e5e7eb] bg-white px-[5px] py-px text-[11px] text-[#64748b]">⌘K</span> : null}
    </label>
  );
  const newButton = (
    <button
      type="button"
      onClick={onCreateDocument}
      className="inline-flex h-[42px] shrink-0 items-center gap-2 whitespace-nowrap rounded-[11px] bg-[var(--theme-primary)] px-[18px] text-[15px] font-semibold text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,.7)] transition-colors hover:bg-[var(--theme-primary-dark)]"
    >
      {signedIn ? '+ New document' : 'Sign in to create'}
    </button>
  );
  const emptyState = (
    <div className="rounded-[16px] border border-dashed border-[#e5e7eb] px-6 py-12 text-center">
      <div className="text-[16px] font-semibold text-[#0f172a]">{query ? 'No documents match your search' : 'No documents yet'}</div>
      <div className="mt-1.5 text-[14px] text-[#64748b]">
        {query
          ? 'Try a different word, or start a new document.'
          : signedIn
            ? 'Start with a blank document, a template above, or open a Word file.'
            : 'Your documents appear here once you sign in.'}
      </div>
    </div>
  );
  const listRow = (document: HomeDocumentItem, meta: string) => (
    <div key={document.id} className="flex items-center gap-3 border-b border-[#f1f5f9] py-3">
      <button type="button" onClick={() => onOpenDocument(document.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <DocumentPreview document={document} compact />
        <span className="min-w-0">
          <b className={`block truncate font-bold text-[#0f172a] ${phone ? 'text-[15.5px]' : 'text-[14.5px]'}`}>{title(document)}</b>
          <span className="block truncate text-[13px] text-[#64748b]">{meta}</span>
        </span>
      </button>
      {menuFor(document)}
    </div>
  );
  const sharedNote = (document: HomeDocumentItem) =>
    document.memberCount > 0 ? `Shared with ${document.memberCount}` : document.source === 'shared' ? 'Shared with you' : null;
  const gridCards = (columns: string) => (
    <div className={`grid gap-4 ${columns}`}>
      {documents.map((document) => (
        <article key={document.id} className="group relative overflow-hidden rounded-[16px] border border-[#e5e7eb] bg-white transition-shadow hover:shadow-[0_12px_30px_-18px_rgba(15,23,42,.35)]">
          <button type="button" onClick={() => onOpenDocument(document.id)} className="block w-full text-left">
            <DocumentPreview document={document} />
            <span className="block px-3.5 py-3">
              <b className="block truncate text-[14.5px] font-bold text-[#0f172a]">{title(document)}</b>
              <span className="text-[12.5px] text-[#64748b]">
                Edited {relativeTime(document.updatedAt)}
                {wordsLabel(document) ? ` · ${wordsLabel(document)}` : ''}
                {isShared(document) ? (
                  <span className="ml-1.5 rounded-full bg-[#eff6ff] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--theme-primary-dark)]">
                    {document.source === 'shared' ? 'Shared with you' : 'Shared'}
                  </span>
                ) : null}
              </span>
            </span>
          </button>
          {menuFor(document, `absolute right-2 top-2 rounded-[8px] bg-white/80 ${openMenuId === document.id ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`)}
        </article>
      ))}
    </div>
  );

  return (
    <div ref={rootRef} className="ai-editor-theme min-h-full bg-white text-[#0f172a]">
      {phone ? (
        // Phones: the mockup's app bar (logo, Upgrade, account).
        <div className="flex h-14 items-center gap-2 pl-[18px] pr-3.5">
          <span className="flex-1">
            <VidemakLogo size={30} />
          </span>
          {showUpgrade ? (
            <button type="button" onClick={upgrade} className="flex h-[34px] items-center gap-1 rounded-full bg-[var(--theme-primary)] px-3 text-[13px] font-bold text-white shadow-[0_4px_12px_-4px_rgba(37,99,235,.7)]">
              ⚡ Upgrade
            </button>
          ) : null}
          <a href={navLink('account')} aria-label="Account" className="grid h-[34px] w-[34px] place-items-center rounded-full bg-[#0f172a] text-[14px] font-bold text-white">
            {(name[0] || '·').toUpperCase()}
          </a>
        </div>
      ) : null}

      {/* Laid out by its own width (see useHomeLayout): the side panels can leave it narrow on a wide screen. */}
      <div className={`@container/home ${phone ? 'px-[18px] pb-28 pt-1' : layout === 'narrow' ? 'px-5 pb-12 pt-6' : layout === 'compact' ? 'px-6 pb-12 pt-6' : layout === 'medium' ? 'px-8 pb-12 pt-7' : 'px-10 pb-12 pt-7'}`}>
        {phone ? (
          searchBox('h-[46px] rounded-[14px]', 'text-[16px]', 'Search documents', false)
        ) : tight ? (
          <>
            <h1 className={`${layout === 'narrow' ? 'text-[22px]' : 'text-[24px]'} font-bold leading-[1.2] tracking-[-0.02em] text-[#0f172a]`}>{signedIn ? greeting(name) : 'Documents'}</h1>
            {searchBox('mt-3.5 h-[42px] rounded-[12px]', 'text-[15px]', 'Search your documents', true)}
          </>
        ) : layout === 'medium' ? (
          <>
            <div className="flex items-center gap-3.5">
              <h1 className="min-w-0 flex-1 truncate text-[24px] font-bold tracking-[-0.02em] text-[#0f172a]">{signedIn ? greeting(name) : 'Documents'}</h1>
              {newButton}
            </div>
            {searchBox('mt-3.5 h-11 rounded-[12px]', 'text-[15px]', 'Search your documents', true)}
          </>
        ) : (
          <div className="mb-[26px] flex flex-wrap items-center gap-x-3.5 gap-y-3">
            <h1 className="w-full whitespace-nowrap text-[26px] font-bold tracking-[-0.02em] text-[#0f172a] @[760px]/home:w-auto">{signedIn ? greeting(name) : 'Documents'}</h1>
            {searchBox('h-11 max-w-[520px] flex-1 rounded-[12px] @[760px]/home:ml-auto', 'text-[15px]', 'Search your documents', true)}
            {newButton}
          </div>
        )}

        {phone ? (
          <>
            <p className="mb-2.5 mt-[18px] text-[13px] font-bold uppercase tracking-[0.06em] text-[#94a3b8]">Start something new</p>
            <div className="-mx-[18px] flex gap-2.5 overflow-x-auto px-[18px] pb-1">
              {starts.map((start) => startItem(start, 'group flex w-[104px] shrink-0 flex-col rounded-[14px] border border-[#e5e7eb] bg-white p-2.5 text-left', (
                <>{preview(start, 'phone')}<span className="block text-[13px] font-semibold text-[#0f172a]">{start.short}</span></>
              )))}
            </div>
          </>
        ) : layout === 'narrow' ? (
          <>
            <h2 className="mb-2.5 mt-6 text-[16px] font-bold text-[#0f172a]">Start something new</h2>
            <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pb-1 [scrollbar-width:thin]">
              {starts.map((start) => startItem(start, 'group flex w-[96px] shrink-0 flex-col rounded-[14px] border border-[#e5e7eb] bg-white p-2.5 text-left transition-shadow hover:shadow-[0_8px_24px_-14px_rgba(15,23,42,.35)]', (
                <>{preview(start, 'phone')}<span className="block truncate text-[13px] font-semibold text-[#0f172a]">{start.short}</span></>
              )))}
            </div>
          </>
        ) : layout === 'compact' ? (
          <>
            <h2 className="mb-2.5 mt-6 text-[16px] font-bold text-[#0f172a]">Start something new</h2>
            <div className="grid grid-cols-1 gap-2.5 @[340px]/home:grid-cols-2">
              {starts.map((start) => startItem(
                start,
                `group flex min-w-0 items-center gap-[11px] rounded-[14px] border p-[11px] text-left transition-shadow hover:shadow-[0_8px_24px_-14px_rgba(15,23,42,.35)] ${
                  start.kind === 'blank' ? 'col-span-full border-[#dbeafe] bg-[#eff6ff]' : 'border-[#e5e7eb] bg-white'}`,
                <>
                  {preview(start, 'icon')}
                  <span className="min-w-0">
                    <b className="block truncate text-[14px] font-semibold text-[#0f172a]">{start.kind === 'blank' ? start.name : start.short}</b>
                    <span className="mt-0.5 block truncate text-[12.5px] text-[#64748b]">{start.kind === 'blank' ? start.description : start.tagline}</span>
                  </span>
                </>,
              ))}
            </div>
          </>
        ) : layout === 'medium' ? (
          <>
            <h2 className="mb-2.5 mt-6 text-[16px] font-bold text-[#0f172a]">Start something new</h2>
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${starts.length}, minmax(0, 1fr))` }}>
              {starts.map((start) => startItem(start, 'group flex min-w-0 flex-col text-left', (
                <>
                  {preview(start, 'medium')}
                  <b className="mt-2 block truncate text-[13.5px] font-semibold text-[#0f172a]">{start.short}</b>
                  <span className="block text-[12px] leading-[1.35] text-[#64748b]">{start.tagline}</span>
                </>
              )))}
            </div>
          </>
        ) : (
          <div className="mb-[34px] grid grid-cols-3 gap-4 @[880px]/home:grid-cols-5">
            {starts.map((start) => startItem(start, 'group flex flex-col rounded-[16px] border border-[#e5e7eb] bg-white p-3.5 text-left transition-shadow hover:shadow-[0_8px_24px_-14px_rgba(15,23,42,.35)]', (
              <>
                {preview(start, 'wide')}
                <span className="block text-[15px] font-bold text-[#0f172a]">{start.name}</span>
                <span className="mt-[3px] block text-[13px] leading-[1.35] text-[#64748b]">{start.description}</span>
              </>
            )))}
          </div>
        )}

        <div className={`flex items-center gap-2 ${phone ? 'mb-2.5 mt-[18px]' : layout === 'wide' ? 'mb-3.5' : 'mb-2 mt-7'}`}>
          <h2 className={`mr-auto ${phone ? 'text-[13px] font-bold uppercase tracking-[0.06em] text-[#94a3b8]' : `${layout === 'wide' ? 'text-[18px]' : 'text-[16px]'} font-bold text-[#0f172a]`}`}>
            {phone ? 'Recent' : 'Recent documents'}
          </h2>
          {phone ? null : tight ? filterSelect : <div className="flex items-center gap-2">{filterButtons}</div>}
        </div>

        {documents.length === 0 ? emptyState : phone ? (
          <div>
            {documents.map((document) => listRow(document, [capitalize(relativeTime(document.updatedAt)), sharedNote(document) ?? wordsLabel(document)].filter(Boolean).join(' · ')))}
          </div>
        ) : tight ? (
          <div>
            {documents.map((document) => listRow(document, [`Edited ${relativeTime(document.updatedAt)}`, wordsLabel(document), sharedNote(document)].filter(Boolean).join(' · ')))}
          </div>
        ) : layout === 'medium' ? (
          view === 'grid' ? gridCards('grid-cols-2') : (
            <div>
              {documents.map((document) => (
                <div key={document.id} className="grid grid-cols-[minmax(0,1fr)_112px_36px] items-center gap-3 border-b border-[#f1f5f9] py-2.5">
                  <button type="button" onClick={() => onOpenDocument(document.id)} className="flex min-w-0 items-center gap-3 text-left">
                    <DocumentPreview document={document} compact />
                    <span className="min-w-0">
                      <b className="block truncate text-[14.5px] font-bold text-[#0f172a]">{title(document)}</b>
                      <span className="block truncate text-[13px] text-[#64748b]">{[wordsLabel(document), sharedNote(document)].filter(Boolean).join(' · ') || '—'}</span>
                    </span>
                  </button>
                  <span className="text-[13px] text-[#64748b]">{capitalize(relativeTime(document.updatedAt))}</span>
                  {menuFor(document)}
                </div>
              ))}
            </div>
          )
        ) : view === 'grid' ? (
          gridCards('grid-cols-2 @[700px]/home:grid-cols-3 @[1000px]/home:grid-cols-4')
        ) : (
          <div className="overflow-visible rounded-[16px] border border-[#e5e7eb]">
            <div className="grid grid-cols-[minmax(0,1fr)_160px_140px_110px_44px] items-center gap-4 border-b border-[#f1f5f9] px-4 py-2.5 text-[12px] text-[#64748b]">
              <div>Name</div>
              <div>Last edited</div>
              <div>Words</div>
              <div>Access</div>
              <div />
            </div>
            {documents.map((document, index) => (
              <div key={document.id} className={`grid grid-cols-[minmax(0,1fr)_160px_140px_110px_44px] items-center gap-4 px-4 py-2 text-[13.5px] ${index ? 'border-t border-[#f1f5f9]' : ''}`}>
                <button type="button" onClick={() => onOpenDocument(document.id)} className="flex min-w-0 items-center gap-3 text-left">
                  <DocumentPreview document={document} compact />
                  <span className="truncate font-semibold text-[#0f172a]">{title(document)}</span>
                </button>
                <div className="text-[#64748b]">{capitalize(relativeTime(document.updatedAt))}</div>
                <div className="text-[#64748b]">{wordsLabel(document) ?? '—'}</div>
                <div>
                  <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${isShared(document) ? 'bg-[#eff6ff] text-[var(--theme-primary-dark)]' : 'bg-[#f1f5f9] text-[#334155]'}`}>
                    {document.source === 'shared' ? 'Shared with you' : isShared(document) ? 'Shared' : 'Private'}
                  </span>
                </div>
                {menuFor(document)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type HomeLayout = 'phone' | 'narrow' | 'compact' | 'medium' | 'wide';

/**
 * The documents page's layout from the width it actually has, not the screen's: with the menu,
 * Find papers and AI Chat open beside it, a laptop can leave it as narrow as a phone. Measured
 * before the first paint, so there is no jump.
 */
function useHomeLayout(ref: React.RefObject<HTMLElement | null>): HomeLayout {
  const [layout, setLayout] = useState<HomeLayout>('wide');
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const width = element.getBoundingClientRect().width;
      setLayout(window.innerWidth < 768 ? 'phone' : width < 400 ? 'narrow' : width < 560 ? 'compact' : width < 900 ? 'medium' : 'wide');
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [ref]);
  return layout;
}
