"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  getDocuments,
  type LibraryDocumentResponse,
} from '../../utils/libraryApi';
import {
  documentScopeParams,
  getScopedLibraryFolders,
  PERSONAL_LIBRARY_SCOPE_ID,
  type LibraryScope,
  type ScopedFolder,
} from '../../utils/libraryScopes';

interface CitationInsertModalProps {
  isOpen: boolean;
  isLoading?: boolean;
  onClose: () => void;
  onSelect: (document: LibraryDocumentResponse) => Promise<void> | void;
}

export default function CitationInsertModal({
  isOpen,
  isLoading = false,
  onClose,
  onSelect,
}: CitationInsertModalProps) {
  const [folders, setFolders] = useState<ScopedFolder[]>([]);
  const [scopes, setScopes] = useState<LibraryScope[]>([]);
  const [documents, setDocuments] = useState<LibraryDocumentResponse[]>([]);
  const [selectedScopeId, setSelectedScopeId] = useState<string>(PERSONAL_LIBRARY_SCOPE_ID);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFetching, setIsFetching] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setSelectedFolderId(null);
    setSelectedScopeId(PERSONAL_LIBRARY_SCOPE_ID);
    setSelectedDocumentId(null);
    setSearchQuery('');

    void (async () => {
      try {
        const folderData = await getScopedLibraryFolders();
        setFolders(folderData.folders);
        setScopes(folderData.scopes);
      } catch (error) {
        console.error('Failed to load citation folders:', error);
      }
    })();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    void (async () => {
      setIsFetching(true);
      try {
        const data = await getDocuments({
          ...documentScopeParams(selectedScopeId, selectedFolderId),
          status: 'ready',
          page_size: 100,
          order_by: 'created_at',
          order_desc: true,
          search: searchQuery || undefined,
        });
        setDocuments(data.documents);
      } catch (error) {
        console.error('Failed to load citation documents:', error);
        setDocuments([]);
      } finally {
        setIsFetching(false);
      }
    })();
  }, [isOpen, searchQuery, selectedFolderId, selectedScopeId]);

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) || null,
    [documents, selectedDocumentId],
  );

  const renderSubtitle = (document: LibraryDocumentResponse): string => {
    const titleBits = [
      Array.isArray(document.authors) && document.authors.length > 0
        ? document.authors.slice(0, 2).join(', ')
        : null,
      document.publication_date
        ? new Date(document.publication_date).getFullYear().toString()
        : null,
      document.doi || null,
    ].filter(Boolean);

    return titleBits.join(' • ') || document.filename;
  };

  const handleConfirm = async () => {
    if (!selectedDocument || isLoading) return;
    await onSelect(selectedDocument);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[13000] flex items-center justify-center bg-[rgba(15,23,42,0.35)] p-4"
        onClick={() => {
          if (!isLoading) onClose();
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ duration: 0.18 }}
          className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-[14px] bg-white border border-[#e5e7eb] shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between border-b border-[#e5e7eb] px-6 py-4">
            <div>
              <h3 className="text-[18px] font-bold text-[#0f172a]">Add citation</h3>
              <p className="mt-0.5 text-sm text-[#64748b]">
                Search your reference manager, open a folder, and insert a paper as a live citation node.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="rounded-lg p-1.5 text-[#64748b] transition-colors hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="border-b border-[#f1f5f9] px-6 py-3">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search papers, authors, DOI, or filename"
                className="w-full rounded-lg border border-[#e5e7eb] py-2 pl-9 pr-3 text-sm focus:border-[#93c5fd] focus:outline-none focus:ring-1 focus:ring-[#bfdbfe]"
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <aside className="w-56 shrink-0 overflow-y-auto border-r border-[#f1f5f9] bg-[#f8fafc]/60 py-2">
              <button
                type="button"
                onClick={() => setSelectedFolderId(null)}
                className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors ${
                  selectedFolderId === null
                    ? 'bg-[#eff6ff] font-medium text-[#1d4ed8]'
                    : 'text-[#64748b] hover:bg-[#f1f5f9]'
                }`}
              >
                <span>All Papers</span>
              </button>
              <div className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                Libraries
              </div>
              {scopes.map((scope) => (
                <button
                  type="button"
                  key={scope.id}
                  onClick={() => {
                    setSelectedScopeId(scope.id);
                    setSelectedFolderId(null);
                  }}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors ${
                    selectedScopeId === scope.id && selectedFolderId === null
                      ? 'bg-[#eff6ff] font-medium text-[#1d4ed8]'
                      : 'text-[#334155] hover:bg-[#f1f5f9]'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{scope.label}</span>
                    <span className="block truncate text-[10px] text-[#94a3b8]">
                      {scope.groupLibraryId ? 'Group library' : 'Personal library'}
                    </span>
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-[#94a3b8]">
                    {scope.groupLibraryId ? 'Group' : 'Personal'}
                  </span>
                </button>
              ))}
              <div className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                Folders
              </div>
              {folders.filter((folder) => folder.scopeId === selectedScopeId).map((folder) => (
                <button
                  type="button"
                  key={folder.id}
                  onClick={() => setSelectedFolderId(folder.id)}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors ${
                    selectedFolderId === folder.id
                      ? 'bg-[#eff6ff] font-medium text-[#1d4ed8]'
                      : 'text-[#64748b] hover:bg-[#f1f5f9]'
                  }`}
                >
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                    />
                  </svg>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{folder.name}</span>
                    {folder.scopeLabel !== 'My Library' ? (
                      <span className="block truncate text-[10px] text-[#94a3b8]">{folder.scopeLabel}</span>
                    ) : null}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-[#94a3b8]">{folder.document_count}</span>
                </button>
              ))}
              {folders.filter((folder) => folder.scopeId === selectedScopeId).length === 0 ? (
                <div className="px-4 py-2 text-xs text-[#94a3b8]">
                  No folders in this library.
                </div>
              ) : null}
            </aside>

            <section className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-[#f1f5f9] px-4 py-2 text-xs font-medium uppercase tracking-wide text-[#64748b]">
                {isFetching ? 'Loading papers...' : `${documents.length} paper${documents.length === 1 ? '' : 's'}`}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {documents.length === 0 && !isFetching ? (
                  <div className="px-4 py-8 text-sm text-[#64748b]">
                    No matching references found in this folder.
                  </div>
                ) : (
                  documents.map((document) => {
                    const isSelected = document.id === selectedDocumentId;
                    return (
                      <button
                        type="button"
                        key={document.id}
                        onClick={() => setSelectedDocumentId(document.id)}
                        className={`block w-full border-b border-[#f1f5f9] px-4 py-3 text-left transition-colors ${
                          isSelected ? 'bg-[#eff6ff]' : 'hover:bg-[#f8fafc]'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-0.5 h-4 w-4 rounded-full border ${
                              isSelected ? 'border-[#2563eb] bg-[#2563eb]' : 'border-[#cbd5e1] bg-white'
                            }`}
                          >
                            {isSelected ? <div className="mx-auto mt-1 h-1.5 w-1.5 rounded-full bg-white" /> : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-[#0f172a]">
                              {document.title || document.filename}
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs text-[#64748b]">
                              {renderSubtitle(document)}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          </div>

          <div className="flex items-center justify-between border-t border-[#e5e7eb] px-6 py-4">
            <div className="text-sm text-[#64748b]">
              {selectedDocument ? `Selected: ${selectedDocument.title || selectedDocument.filename}` : 'Choose a paper to cite'}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="rounded-lg border border-[#e5e7eb] px-3 py-2 text-sm font-medium text-[#64748b] transition-colors hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={!selectedDocument || isLoading}
                className="rounded-lg bg-[#2563eb] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? 'Adding citation...' : 'Add Citation'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
