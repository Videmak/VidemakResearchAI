'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LuGlobe, LuLibrary, LuLayers, LuSparkles, LuX } from 'react-icons/lu';
import { getFolders, type FolderResponse, type LibraryDocumentResponse } from '../../utils/libraryApi';

/** What "Write with AI" drafts from: the topic, where its sources come from, and which ones. */
export type StartWritingConfig = {
  topic: string;
  sourceType: 'web' | 'myfiles' | 'hybrid';
  selectedDocuments: LibraryDocumentResponse[];
  selectedFolderId: string | null;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onStart: (config: StartWritingConfig) => void;
  initialSource?: string;
  /** Prefills the topic (the document's title). */
  initialTopic?: string;
};

const SOURCES: { id: StartWritingConfig['sourceType']; label: string; icon: React.ReactNode }[] = [
  { id: 'web', label: 'Published papers', icon: <LuGlobe className="h-4 w-4" /> },
  { id: 'myfiles', label: 'My Library', icon: <LuLibrary className="h-4 w-4" /> },
  { id: 'hybrid', label: 'Both', icon: <LuLayers className="h-4 w-4" /> },
];

/**
 * "Write with AI": the AI drafts the document section by section (title, paragraphs with
 * citations, conclusion), each shown under the page to accept, change or skip.
 */
export default function StartWritingModal({ isOpen, onClose, onStart, initialSource, initialTopic }: Props) {
  const [topic, setTopic] = useState('');
  const [sourceType, setSourceType] = useState<StartWritingConfig['sourceType']>('web');
  const [folders, setFolders] = useState<FolderResponse[]>([]);
  const [folderId, setFolderId] = useState('');
  const topicRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTopic((current) => current || (initialTopic && initialTopic !== 'Untitled document' ? initialTopic : ''));
    if (initialSource === 'web' || initialSource === 'myfiles' || initialSource === 'hybrid') setSourceType(initialSource);
    getFolders().then(setFolders).catch(() => setFolders([]));
    window.setTimeout(() => topicRef.current?.focus(), 0);
  }, [initialSource, initialTopic, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;
  const ready = topic.trim().length >= 3;
  const start = () => {
    if (!ready) return;
    onStart({ topic: topic.trim(), sourceType, selectedDocuments: [], selectedFolderId: sourceType === 'web' ? null : folderId || null });
  };

  return createPortal(
    <div className="fixed inset-0 z-[13000] flex items-end justify-center bg-[rgba(15,23,42,.35)] sm:items-center sm:p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Write with AI" className="relative w-full max-w-[520px] rounded-t-[20px] bg-white p-6 shadow-[0_22px_50px_-18px_rgba(15,23,42,.35)] sm:rounded-[16px]">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[#eff6ff] text-[var(--theme-primary,#2563eb)]">
            <LuSparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-bold text-[#0f172a]">Write with AI</h2>
            <p className="mt-0.5 text-[13.5px] text-[#64748b]">Drafts it section by section, with citations. You accept each part.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a]">
            <LuX className="h-[18px] w-[18px]" />
          </button>
        </div>
        <label className="mt-5 block text-[13px] font-semibold text-[#334155]" htmlFor="ce-start-writing-topic">Topic or research question</label>
        <textarea
          id="ce-start-writing-topic"
          ref={topicRef}
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) start();
          }}
          rows={3}
          placeholder="e.g. How does sleep affect memory in university students?"
          className="mt-1.5 block w-full resize-none rounded-[12px] border border-[#e2e8f0] px-3.5 py-2.5 text-[15px] leading-[1.45] text-[#0f172a] outline-none placeholder:text-[#94a3b8] focus:border-[var(--theme-primary,#2563eb)] focus:shadow-[0_0_0_3px_#eff6ff]"
        />
        <p className="mt-4 text-[13px] font-semibold text-[#334155]">Sources</p>
        <div role="radiogroup" aria-label="Sources" className="mt-1.5 grid grid-cols-3 gap-1.5">
          {SOURCES.map((source) => (
            <button
              key={source.id}
              type="button"
              role="radio"
              aria-checked={sourceType === source.id}
              onClick={() => setSourceType(source.id)}
              className={`flex h-10 items-center justify-center gap-1.5 rounded-[10px] border text-[13px] font-medium transition-colors ${
                sourceType === source.id ? 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]' : 'border-[#e5e7eb] text-[#334155] hover:bg-[#f8fafc]'
              }`}
            >
              {source.icon}
              {source.label}
            </button>
          ))}
        </div>
        {sourceType !== 'web' && folders.length ? (
          <select
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
            aria-label="Library collection"
            className="mt-2 h-10 w-full rounded-[10px] border border-[#e5e7eb] bg-white px-3 text-[14px] text-[#0f172a] outline-none focus:border-[var(--theme-primary,#2563eb)]"
          >
            <option value="">All of my Library</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-[11px] px-4 text-[14px] font-semibold text-[#334155] hover:bg-[#f1f5f9]">Cancel</button>
          <button
            type="button"
            onClick={start}
            disabled={!ready}
            className="h-10 rounded-[11px] bg-[var(--theme-primary,#2563eb)] px-[18px] text-[14px] font-semibold text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,.7)] hover:bg-[var(--theme-primary-dark,#1d4ed8)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start writing
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export { StartWritingModal };
