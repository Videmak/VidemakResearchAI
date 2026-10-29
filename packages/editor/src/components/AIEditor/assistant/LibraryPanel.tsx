'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LuChevronRight, LuCopy, LuExternalLink, LuFileText, LuFolder, LuLibrary, LuMessageCircle, LuQuote, LuSearch, LuUpload, LuX } from 'react-icons/lu';
import { toast } from 'react-hot-toast';
import { getDocuments, getFolders, uploadDocument, type FolderResponse, type LibraryDocumentResponse } from '../../../utils/libraryApi';
import { copyLibraryReference, LIBRARY_CHANGED_EVENT, notifyLibraryChanged } from '../../../lib/aiEditor/references';
import { askAboutInSideloadChat } from '../../../lib/sideloads';

type Props = {
  /** In a document: cite into it. Elsewhere "Copy" puts the reference on the clipboard. */
  onCite?: (document: LibraryDocumentResponse) => void;
  /** Defaults to the app's AI Chat with this source attached. */
  onAsk?: (document: LibraryDocumentResponse) => void;
  citing?: boolean;
  /** False while the panel waits hidden behind another tab; showing it again reloads the list. */
  visible?: boolean;
};

export function libraryDocumentYear(document: Pick<LibraryDocumentResponse, 'publication_date'>) {
  const match = /\d{4}/.exec(String(document.publication_date || ''));
  return match ? match[0] : '';
}

export function libraryDocumentUrl(document: LibraryDocumentResponse) {
  const metadata = (document.metadata || {}) as Record<string, unknown>;
  if (document.doi) return `https://doi.org/${String(document.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}`;
  if (typeof metadata.url === 'string') return metadata.url;
  if (typeof metadata.original_url === 'string') return metadata.original_url;
  return '';
}

/** The writer's Library (beside the document or in the app's left drawer): search, cite, ask about a PDF, upload. */
export default function LibraryPanel({ onCite, onAsk, citing, visible = true }: Props) {
  const ask = onAsk || ((document: LibraryDocumentResponse) => askAboutInSideloadChat({ id: document.id, title: document.title || document.filename }));
  const cite = (document: LibraryDocumentResponse) => {
    if (onCite) {
      onCite(document);
      return;
    }
    copyLibraryReference(document)
      .then(() => toast.success('Reference copied'))
      .catch(() => toast.error('The reference could not be copied.'));
  };
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'sources' | 'collections'>('sources');
  const [folderId, setFolderId] = useState('');
  const [folders, setFolders] = useState<FolderResponse[]>([]);
  const [documents, setDocuments] = useState<LibraryDocumentResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);

  const load = useCallback(async (search: string, folder: string) => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await getDocuments({
        search: search.trim() || undefined,
        folder_id: folder || undefined,
        page_size: 40,
        order_by: 'created_at',
        order_desc: true,
      });
      if (request !== requestRef.current) return;
      setDocuments(response.documents);
      setTotal(response.total);
    } catch (caught) {
      if (request === requestRef.current) setError((caught as Error).message || 'Your Library could not be loaded.');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    getFolders().then(setFolders).catch(() => setFolders([]));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query, folderId), query ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [folderId, load, query]);

  // Saved papers and uploads from other panels show up without a page reload.
  const latest = useRef({ query, folderId });
  latest.current = { query, folderId };
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      void load(latest.current.query, latest.current.folderId);
      getFolders().then(setFolders).catch(() => undefined);
    }
    wasVisible.current = visible;
  }, [load, visible]);
  useEffect(() => {
    const reload = () => void load(latest.current.query, latest.current.folderId);
    window.addEventListener(LIBRARY_CHANGED_EVENT, reload);
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, reload);
  }, [load]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      await uploadDocument(file, { folder_id: folderId || undefined });
      toast.success(`${file.name} added to your Library. It will be ready to cite in a moment.`);
      notifyLibraryChanged();
    } catch (caught) {
      toast.error((caught as Error).message || 'The upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const smallButton = 'inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12.5px] font-medium text-[#475569] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a] disabled:opacity-60';

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="px-3 pt-3">
        <div className="flex items-center gap-1.5">
          <div className="group relative min-w-0 flex-1">
            <LuSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8] group-focus-within:text-[var(--theme-primary,#2563eb)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={total ? `Search ${total} source${total === 1 ? '' : 's'}` : 'Search Library'}
              aria-label="Search your Library"
              className="h-9 w-full rounded-[10px] border border-[#e2e8f0] bg-white pl-9 pr-3 text-[14px] text-[#0f172a] outline-none transition-[border,box-shadow] placeholder:text-[#94a3b8] focus:border-[var(--theme-primary,#2563eb)] focus:shadow-[0_0_0_3px_#eff6ff]"
            />
          </div>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            aria-label="Upload a PDF"
            title="Upload a PDF"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-[#eff6ff] px-3 text-[13px] font-semibold text-[#1d4ed8] transition-colors hover:bg-[#dbeafe] disabled:opacity-60"
          >
            {uploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#bfdbfe] border-t-[var(--theme-primary,#2563eb)]" /> : <LuUpload className="h-4 w-4" />}
            Upload
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.doc,.txt,.md,.epub"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void handleUpload(file);
            }}
          />
        </div>
        {/* Sources and Collections (folders). */}
        <div className="mt-2 flex items-center gap-4 border-b border-[#f1f5f9] px-1">
          {(['sources', 'collections'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={`-mb-px h-9 border-b-2 text-[13.5px] transition-colors ${view === value ? 'border-[var(--theme-primary,#2563eb)] font-semibold text-[#0f172a]' : 'border-transparent font-medium text-[#64748b] hover:text-[#0f172a]'}`}
            >
              {value === 'sources' ? 'Sources' : 'Collections'}
              <span className="ml-1.5 font-normal text-[#94a3b8]">{value === 'sources' ? total || '' : folders.length || ''}</span>
            </button>
          ))}
          {folderId ? (
            <span className="ml-auto inline-flex max-w-[50%] items-center gap-1 rounded-md bg-[#eff6ff] px-1.5 py-0.5 text-[12px] text-[#1d4ed8]">
              <LuFolder className="h-3 w-3 shrink-0" />
              <span className="truncate">{folders.find((folder) => folder.id === folderId)?.name || 'Folder'}</span>
              <button type="button" aria-label="All sources" onClick={() => setFolderId('')}><LuX className="h-3 w-3" /></button>
            </span>
          ) : null}
        </div>
      </div>

      {view === 'collections' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2">
          {folders.length === 0 ? <p className="py-8 text-center text-[13px] text-[#94a3b8]">No collections yet</p> : null}
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => {
                setFolderId(folder.id);
                setView('sources');
              }}
              className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left hover:bg-[#f8fafc]"
            >
              <LuFolder className="h-[18px] w-[18px] shrink-0 text-[var(--theme-primary,#2563eb)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-[#0f172a]">{folder.name}</span>
                <span className="block text-[12px] text-[#64748b]">{folder.document_count} source{folder.document_count === 1 ? '' : 's'}</span>
              </span>
              <LuChevronRight className="h-4 w-4 text-[#cbd5e1]" />
            </button>
          ))}
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-1">
        {error ? <div className="mt-2 rounded-[12px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#991b1b]">{error}</div> : null}
        {!loading && !error && documents.length === 0 ? (
          query ? (
            <p className="py-8 text-center text-[13px] text-[#94a3b8]">No matches</p>
          ) : (
            <div className="flex flex-col items-center px-6 pt-14 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[#f1f5f9] text-[#94a3b8]"><LuLibrary className="h-5 w-5" /></span>
              <p className="mt-3 text-[14px] font-semibold text-[#0f172a]">Your Library is empty</p>
              <p className="mt-1 text-[13px] text-[#64748b]">Add PDFs to cite and chat with them.</p>
              <button type="button" onClick={() => fileInput.current?.click()} className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#eff6ff] px-3 text-[13px] font-semibold text-[#1d4ed8] transition-colors hover:bg-[#dbeafe]">
                <LuUpload className="h-4 w-4" />Add PDF
              </button>
            </div>
          )
        ) : null}
        <div>
          {documents.map((document) => {
            const year = libraryDocumentYear(document);
            const url = libraryDocumentUrl(document);
            const authors = (document.authors || []).filter(Boolean);
            const expanded = expandedId === document.id;
            const processing = ['pending', 'processing', 'reprocessing'].includes(String(document.processing_status));
            const failed = String(document.processing_status) === 'failed';
            const isPdf = /pdf/i.test(String(document.file_type || document.filename || ''));
            // "Diekelmann, Susanne" and "Susanne Diekelmann" both give "Diekelmann".
            const surname = (name: string) => (name.includes(',') ? name.split(',')[0].trim() : name.trim().split(/\s+/).pop() || name);
            const authorLabel = authors.length
              ? authors.length > 2
                ? `${surname(authors[0])} et al.`
                : authors.map(surname).join(' & ')
              : 'Unknown authors';
            return (
              <article key={document.id} className="group flex gap-2.5 rounded-[12px] px-2 py-2.5 transition-colors hover:bg-[#f8fafc]">
                <span
                  className={`mt-0.5 grid h-10 w-8 shrink-0 place-items-center rounded-md text-[9.5px] font-bold ${isPdf ? 'bg-[#fef2f2] text-[#dc2626]' : 'bg-[#f1f5f9] text-[#94a3b8]'}`}
                  aria-hidden="true"
                >
                  {isPdf ? 'PDF' : <LuFileText className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => setExpandedId(expanded ? null : document.id)} aria-expanded={expanded} className="block w-full text-left">
                    <h4 className={`text-[13.5px] font-semibold leading-[1.35] text-[#0f172a] ${expanded ? '' : 'line-clamp-2'}`}>{document.title || document.filename}</h4>
                    <p className="mt-0.5 truncate text-[12.5px] text-[#64748b]">
                      {authorLabel}
                      {year ? ` · ${year}` : ''}
                      {document.publisher && !expanded ? <span className="italic"> · {document.publisher}</span> : null}
                    </p>
                    {processing ? (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-[#fffbeb] px-1.5 py-0.5 text-[11.5px] font-medium text-[#b45309]">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#f59e0b]" />Processing
                      </span>
                    ) : failed ? (
                      <span className="mt-1 inline-flex rounded-md bg-[#fef2f2] px-1.5 py-0.5 text-[11.5px] font-medium text-[#b91c1c]">Could not read</span>
                    ) : null}
                    {(document as { folder_id?: string | null }).folder_id && !folderId ? (
                      <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-md border border-[#e5e7eb] px-1.5 py-0.5 text-[11.5px] text-[#475569]">
                        <LuFolder className="h-3 w-3 shrink-0 text-[var(--theme-primary,#2563eb)]" />
                        <span className="truncate">{folders.find((folder) => folder.id === (document as { folder_id?: string | null }).folder_id)?.name || 'Folder'}</span>
                      </span>
                    ) : null}
                  </button>
                  {expanded ? (
                    <div className="mt-2 space-y-1.5 text-[13px] text-[#334155]">
                      {document.publisher ? <p className="text-[12.5px] italic text-[#64748b]">{document.publisher}</p> : null}
                      {document.abstract ? <p className="leading-[1.5]">{document.abstract}</p> : <p className="text-[#64748b]">No abstract.</p>}
                      {document.doi ? (
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard?.writeText(String(document.doi)).then(() => toast.success('DOI copied')).catch(() => undefined)}
                          className="inline-flex items-center gap-1 text-[12.5px] text-[#64748b] hover:text-[#0f172a]"
                        >
                          <LuCopy className="h-3.5 w-3.5" /> {document.doi}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="-ml-0.5 mt-1.5 flex flex-wrap gap-0.5">
                    <button
                      type="button"
                      disabled={citing}
                      onClick={() => cite(document)}
                      className="mr-1 inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--theme-primary,#2563eb)] px-2.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#1d4ed8] disabled:opacity-60"
                    >
                      {onCite ? <><LuQuote className="h-3.5 w-3.5" />Cite</> : <><LuCopy className="h-3.5 w-3.5" />Copy</>}
                    </button>
                    <button type="button" onClick={() => ask(document)} className={smallButton}>
                      <LuMessageCircle className="h-3.5 w-3.5" />Ask
                    </button>
                    {url ? (
                      <button type="button" onClick={() => window.open(url, '_blank', 'noopener')} className={smallButton}>
                        <LuExternalLink className="h-3.5 w-3.5" />Open
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {loading ? (
          <div className="space-y-3 pt-3">
            {[0, 1, 2].map((index) => <div key={index} className="h-[72px] animate-pulse rounded-[12px] bg-[#f8fafc]" />)}
          </div>
        ) : null}
      </div>
      )}
    </div>
  );
}
