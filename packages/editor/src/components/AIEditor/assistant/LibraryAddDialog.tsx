'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LuCheck, LuCircleAlert, LuFileText, LuFileUp, LuHash, LuLibrary, LuLoader, LuUpload, LuX } from 'react-icons/lu';
import {
  getFolders, getLibraryLimits, importIds, importReferenceFile, uploadDocumentWithProgress,
  type FolderResponse, type LibraryLimits,
} from '../../../utils/libraryApi';
import { notifyLibraryChanged } from '../../../lib/aiEditor/references';
import { getEditorConfig } from '../../../runtime';
import { ReferenceManagerPane } from './LibraryConnections';
import { FindPdfs, ImportProgress, UpgradeCard, plural, useImportJob } from './LibraryImportParts';

export type AddTab = 'pdfs' | 'zotero' | 'mendeley' | 'file' | 'ids';

type Props = {
  open: boolean;
  onClose: () => void;
  /** The collection the panel shows; new items go there unless another is chosen. */
  folderId?: string | null;
  initialTab?: AddTab;
};

type Upload = { id: number; file: File; progress: number; status: 'waiting' | 'uploading' | 'done' | 'failed'; error?: string; upgrade?: boolean };

const TABS: { id: AddTab; label: string; icon: React.ReactNode }[] = [
  { id: 'pdfs', label: 'Upload PDFs', icon: <LuFileUp className="h-[18px] w-[18px]" /> },
  { id: 'zotero', label: 'Zotero', icon: <span className="grid h-[18px] w-[18px] place-items-center rounded-[5px] bg-[#cc2936] text-[11px] font-black text-white">Z</span> },
  { id: 'mendeley', label: 'Mendeley', icon: <span className="grid h-[18px] w-[18px] place-items-center rounded-[5px] bg-[#9d1620] text-[11px] font-black text-white">M</span> },
  { id: 'file', label: 'Import .bib/.ris', icon: <LuFileText className="h-[18px] w-[18px]" /> },
  { id: 'ids', label: 'Paste IDs', icon: <LuHash className="h-[18px] w-[18px]" /> },
];

const SIMULTANEOUS = 3;
const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`);
const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/** Upgrade offer: closes the dialog so the host's plans dialog is on top. */
function useUpgrade(onClose: () => void) {
  return useCallback((message?: string) => {
    onClose();
    window.setTimeout(() => getEditorConfig().onUpgrade?.({ reason: 'plan_limit', message }), 50);
  }, [onClose]);
}

/** "Add to Library": PDFs (many at once, drag and drop), Zotero, Mendeley, .bib/.ris files and pasted identifiers. */
export default function LibraryAddDialog({ open, onClose, folderId = null, initialTab = 'pdfs' }: Props) {
  const [tab, setTab] = useState<AddTab>(initialTab);
  const [folders, setFolders] = useState<FolderResponse[]>([]);
  const [target, setTarget] = useState<string>(folderId || '');
  const [limits, setLimits] = useState<LibraryLimits | null>(null);
  const upgrade = useUpgrade(onClose);

  const refreshLimits = useCallback(() => { getLibraryLimits().then(setLimits).catch(() => undefined); }, []);
  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setTarget(folderId || '');
    getFolders().then(setFolders).catch(() => setFolders([]));
    refreshLimits();
  }, [folderId, initialTab, open, refreshLimits]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[14000] flex items-end justify-center bg-[rgba(15,23,42,.45)] sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Add to Library" className="flex h-[min(92dvh,660px)] w-full max-w-[880px] flex-col overflow-hidden rounded-t-[20px] bg-white shadow-[0_24px_60px_-12px_rgba(15,23,42,.35)] sm:rounded-[18px]">
        <div className="flex items-center gap-3 border-b border-[#f1f5f9] px-5 py-4">
          <h2 className="flex-1 text-[18px] font-semibold text-[#0f172a]">Add to Library</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#0f172a]"><LuX className="h-5 w-5" /></button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav aria-label="Ways to add" className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#f1f5f9] px-3 py-2 sm:w-[220px] sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:px-3 sm:py-4">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={tab === item.id ? 'page' : undefined}
                className={`flex h-10 shrink-0 items-center gap-3 whitespace-nowrap rounded-[10px] px-3 text-[14px] font-medium transition-colors ${tab === item.id ? 'bg-[#f1f5f9] text-[#0f172a]' : 'text-[#475569] hover:bg-[#f8fafc]'}`}
              >
                <span className="text-[#475569]" aria-hidden="true">{item.icon}</span>{item.label}
              </button>
            ))}
          </nav>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
              <label htmlFor="library-add-target" className="text-[13.5px] text-[#64748b]">Add to</label>
              <div className="relative">
                <LuLibrary className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
                <select id="library-add-target" value={target} onChange={(event) => setTarget(event.target.value)}
                  className="h-9 max-w-[240px] rounded-[10px] border border-[#e2e8f0] bg-white pl-8 pr-8 text-[14px] text-[#0f172a] outline-none focus:border-[var(--theme-primary,#2563eb)]">
                  <option value="">All sources</option>
                  {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
              </div>
              {limits && limits.pdfs_limit !== null && (
                <span className="ml-auto text-[12.5px] text-[#64748b]" data-testid="pdf-room">{limits.pdfs_used.toLocaleString('en-US')} of {limits.pdfs_limit.toLocaleString('en-US')} PDFs used</span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
              {tab === 'pdfs' && <PdfUploads folderId={target || null} limits={limits} onChanged={refreshLimits} onUpgrade={upgrade} />}
              {tab === 'zotero' && <ReferenceManagerPane provider="zotero" folderId={target || null} allowed={limits?.zotero_import ?? true} planName={limits?.plan.name} onUpgrade={upgrade} onChanged={refreshLimits} />}
              {tab === 'mendeley' && <ReferenceManagerPane provider="mendeley" folderId={target || null} allowed={limits?.mendeley_import ?? true} planName={limits?.plan.name} onUpgrade={upgrade} onChanged={refreshLimits} />}
              {tab === 'file' && <ReferenceFileImport folderId={target || null} onChanged={refreshLimits} />}
              {tab === 'ids' && <PasteIds folderId={target || null} onChanged={refreshLimits} />}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PdfUploads({ folderId, limits, onChanged, onUpgrade }: { folderId: string | null; limits: LibraryLimits | null; onChanged: () => void; onUpgrade: (message?: string) => void }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const active = useRef(0);
  const queue = useRef<Upload[]>([]);
  const folderRef = useRef(folderId);
  folderRef.current = folderId;

  const patch = (id: number, change: Partial<Upload>) => setUploads((list) => list.map((item) => (item.id === id ? { ...item, ...change } : item)));

  const pump = useCallback(() => {
    while (active.current < SIMULTANEOUS && queue.current.length) {
      const next = queue.current.shift()!;
      active.current += 1;
      patch(next.id, { status: 'uploading', progress: 0 });
      uploadDocumentWithProgress(next.file, { folder_id: folderRef.current }, (share) => patch(next.id, { progress: share }))
        .then(() => { patch(next.id, { status: 'done', progress: 1 }); notifyLibraryChanged(); onChanged(); })
        .catch((error: Error & { status?: number }) => patch(next.id, { status: 'failed', error: error.message, upgrade: error.status === 402 }))
        .finally(() => { active.current -= 1; pump(); });
    }
  }, [onChanged]);

  const add = (files: File[]) => {
    setNote(null);
    const pdfs = files.filter(isPdf);
    const skippedType = files.length - pdfs.length;
    const batch = limits?.upload_batch ?? 50;
    const room = limits?.pdfs_left ?? Infinity;
    const waiting = uploads.filter((item) => item.status === 'waiting' || item.status === 'uploading').length;
    const notes: string[] = [];
    if (skippedType) notes.push(`${plural(skippedType, 'file')} skipped: only PDFs can be uploaded here.`);
    let take = pdfs;
    if (take.length > batch) { notes.push(`Your plan uploads ${batch} PDFs at a time. Add the rest when these finish.`); take = take.slice(0, batch); }
    const fresh: Upload[] = take.map((file) => ({ id: ++counter.current, file, progress: 0, status: 'waiting' }));
    for (const [index, item] of fresh.entries()) {
      if (limits && item.file.size > limits.upload_mb * 1024 * 1024) {
        Object.assign(item, { status: 'failed', error: `Over ${limits.upload_mb} MB (${mb(item.file.size)}).`, upgrade: !limits.plan || limits.upload_mb < 100 });
      } else if (index + waiting >= room) {
        Object.assign(item, { status: 'failed', error: 'Your Library is full on this plan.', upgrade: true });
      }
    }
    setNote(notes.join(' ') || null);
    setUploads((list) => [...fresh, ...list].slice(0, 200));
    queue.current.push(...fresh.filter((item) => item.status === 'waiting'));
    pump();
  };

  const full = limits && limits.pdfs_left === 0 && !uploads.some((item) => item.status === 'uploading' || item.status === 'waiting');
  const doneCount = uploads.filter((item) => item.status === 'done').length;
  const busyCount = uploads.filter((item) => item.status === 'uploading' || item.status === 'waiting').length;

  if (full && !uploads.length) {
    return <UpgradeCard title="Your Library is full" text={`The ${limits!.plan.name} plan holds ${limits!.pdfs_limit} PDFs. Upgrade for more, or remove some first.`} onUpgrade={() => onUpgrade()} />;
  }
  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); add([...event.dataTransfer.files]); }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.current?.click(); } }}
        data-testid="pdf-dropzone"
        className={`flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed px-6 py-9 text-center transition-colors ${dragging ? 'border-[var(--theme-primary,#2563eb)] bg-[#eff6ff]' : 'border-[#e2e8f0] bg-[#f8fafc] hover:border-[#bfdbfe]'}`}
      >
        <span className="grid h-12 w-12 place-items-center rounded-full bg-white text-[var(--theme-primary,#2563eb)] shadow-[0_1px_3px_rgba(15,23,42,.12)]"><LuUpload className="h-5 w-5" /></span>
        <p className="mt-3 text-[15px] font-semibold text-[#0f172a]">Drop PDFs here or <span className="text-[var(--theme-primary,#2563eb)]">browse</span></p>
        <p className="mt-1 text-[13px] text-[#64748b]">{limits ? `Up to ${limits.upload_batch} at a time, ${limits.upload_mb} MB each` : 'Several at once'}</p>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(event) => { add([...(event.target.files || [])]); event.target.value = ''; }} />
      </div>
      {note && <p className="text-[13px] text-[#b45309]">{note}</p>}
      {uploads.length > 0 && (
        <div>
          <p className="mb-2 text-[13px] text-[#64748b]">{busyCount ? `Uploading ${busyCount}…` : `${plural(doneCount, 'PDF')} added. They will be ready to cite in a moment.`}</p>
          <ul className="flex flex-col gap-2" data-testid="upload-list">
            {uploads.map((item) => (
              <li key={item.id} className="rounded-xl border border-[#e2e8f0] px-3.5 py-2.5">
                <div className="flex items-center gap-2.5">
                  <LuFileText className="h-4 w-4 shrink-0 text-[#94a3b8]" />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-[#0f172a]">{item.file.name}</span>
                  <span className="shrink-0 text-[12px] text-[#94a3b8]">{mb(item.file.size)}</span>
                  {item.status === 'done' && <LuCheck className="h-4 w-4 shrink-0 text-[#16a34a]" aria-label="Added" />}
                  {item.status === 'failed' && <LuCircleAlert className="h-4 w-4 shrink-0 text-[#dc2626]" aria-label="Not added" />}
                </div>
                {(item.status === 'uploading' || item.status === 'waiting') && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#f1f5f9]"><div className="h-full rounded-full bg-[var(--theme-primary,#2563eb)] transition-[width]" style={{ width: `${Math.round(item.progress * 100)}%` }} /></div>
                )}
                {item.status === 'failed' && (
                  <p className="mt-1 text-[12.5px] text-[#dc2626]">
                    {item.error}
                    {item.upgrade && <button type="button" onClick={() => onUpgrade(item.error)} className="ml-1.5 font-semibold text-[var(--theme-primary,#2563eb)] hover:underline">Upgrade</button>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ReferenceFileImport({ folderId, onChanged }: { folderId: string | null; onChanged: () => void }) {
  const [findPdfs, setFindPdfs] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { job, follow, reset } = useImportJob();
  useEffect(() => { if (job && job.status !== 'running') onChanged(); }, [job, onChanged]);

  const start = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const started = await importReferenceFile(file, { folder_id: folderId, find_pdfs: findPdfs });
      follow(started.job_id);
    } catch (caught) { setError((caught as Error).message); }
  };

  if (job) return <ImportProgress job={job} onAgain={reset} />;
  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void start(event.dataTransfer.files[0]); }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.current?.click(); } }}
        className={`flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed px-6 py-9 text-center transition-colors ${dragging ? 'border-[var(--theme-primary,#2563eb)] bg-[#eff6ff]' : 'border-[#e2e8f0] bg-[#f8fafc] hover:border-[#bfdbfe]'}`}
      >
        <span className="grid h-12 w-12 place-items-center rounded-full bg-white text-[var(--theme-primary,#2563eb)] shadow-[0_1px_3px_rgba(15,23,42,.12)]"><LuFileText className="h-5 w-5" /></span>
        <p className="mt-3 text-[15px] font-semibold text-[#0f172a]">Drop a .bib or .ris file or <span className="text-[var(--theme-primary,#2563eb)]">browse</span></p>
        <p className="mt-1 text-[13px] text-[#64748b]">From EndNote, Zotero, Mendeley, Google Scholar or any reference manager</p>
        <input ref={input} type="file" accept=".bib,.ris,.txt,application/x-bibtex,application/x-research-info-systems" className="hidden" onChange={(event) => { void start(event.target.files?.[0]); event.target.value = ''; }} />
      </div>
      <FindPdfs value={findPdfs} onChange={setFindPdfs} />
      {error && <p role="alert" className="text-[13px] text-[#dc2626]">{error}</p>}
    </div>
  );
}

function PasteIds({ folderId, onChanged }: { folderId: string | null; onChanged: () => void }) {
  const [text, setText] = useState('');
  const [findPdfs, setFindPdfs] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { job, follow, reset } = useImportJob();
  useEffect(() => { if (job && job.status !== 'running') onChanged(); }, [job, onChanged]);
  // Same rules as the server: a "PMID:" label and its number count once.
  const count = useMemo(() => text.split(/[\s,;]+/).filter((part) => /^(10\.\d{4,9}\/\S+|https?:\/\/(dx\.)?doi\.org\/\S+|(pmid:?)?\d{5,9}|(arxiv:)?\d{4}\.\d{4,5}(v\d+)?|https?:\/\/(arxiv\.org|pubmed\.ncbi\.nlm\.nih\.gov)\/\S+)$/i.test(part)).length, [text]);

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const started = await importIds(text, { folder_id: folderId, find_pdfs: findPdfs });
      follow(started.job_id);
      setText('');
    } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };

  if (job) return <ImportProgress job={job} onAgain={reset} />;
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="library-paste-ids" className="text-[14px] font-medium text-[#0f172a]">DOIs, PubMed ids or arXiv ids</label>
      <textarea
        id="library-paste-ids"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={8}
        placeholder={'10.1038/nrn2762\nPMID: 23589831\narXiv:1706.03762'}
        className="w-full resize-y rounded-xl border border-[#e2e8f0] px-3.5 py-3 font-mono text-[13px] leading-relaxed text-[#0f172a] outline-none placeholder:text-[#94a3b8] focus:border-[var(--theme-primary,#2563eb)] focus:shadow-[0_0_0_3px_#eff6ff]"
      />
      <FindPdfs value={findPdfs} onChange={setFindPdfs} />
      {error && <p role="alert" className="text-[13px] text-[#dc2626]">{error}</p>}
      <div>
        <button type="button" disabled={busy || !count} onClick={() => void start()}
          className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[var(--theme-primary,#2563eb)] px-5 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {busy ? <LuLoader className="h-4 w-4 animate-spin" /> : null}{count > 1 ? `Add ${count} papers` : 'Add paper'}
        </button>
      </div>
    </div>
  );
}
