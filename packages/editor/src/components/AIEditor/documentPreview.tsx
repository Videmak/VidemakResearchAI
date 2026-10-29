'use client';

import React, { useEffect, useState } from 'react';
import { browserApiBase } from '../../helpers/getHost';
import { getAuthHeader } from '../../utils/auth/api';
import type { AIEditorDocumentSummary } from '../../types/ai-editor';

/** "2 min ago", "3 h ago", "yesterday", "Oct 24" (with the year when it is not this year). */
export function relativeTime(timestamp: number): string {
  if (!timestamp) return 'just now';
  const now = Date.now();
  const minutes = Math.floor((now - timestamp) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const date = new Date(timestamp);
  const today = new Date();
  if (minutes < 24 * 60 && date.getDate() === today.getDate()) return `${Math.floor(minutes / 60)} h ago`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

// ---- Previews: the title and first lines, read from the server's thumbnail (an SVG of text) ----
type Preview = { title: string; text: string };
const previewCache = new Map<string, Promise<Preview | null>>();

function loadPreview(documentId: string, updatedAt: number): Promise<Preview | null> {
  const key = `${documentId}:${updatedAt}`;
  const cached = previewCache.get(key);
  if (cached) return cached;
  const request = fetch(`${browserApiBase()}/api/ai-editor/documents/${documentId}/thumbnail`, { headers: getAuthHeader() })
    .then((response) => (response.ok ? response.text() : null))
    .then((svg) => {
      if (!svg) return null;
      const texts = Array.from(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('text')).map((node) => node.textContent || '');
      if (!texts.length) return null;
      return { title: texts[0], text: texts.slice(1).join(' ') };
    })
    .catch(() => null);
  previewCache.set(key, request);
  return request;
}

type PreviewDocument = Pick<AIEditorDocumentSummary, 'id' | 'title' | 'updatedAt'>;

/**
 * A document's first page in miniature (the documents home and the Documents drawer).
 * `compact` is the small page glyph of list rows; `small` is the drawer's thumbnail.
 */
export function DocumentPreview({ document, compact = false, small = false }: { document: PreviewDocument; compact?: boolean; small?: boolean }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    if (compact) return;
    let alive = true;
    void loadPreview(document.id, document.updatedAt).then((value) => {
      if (alive) setPreview(value);
    });
    return () => {
      alive = false;
    };
  }, [compact, document.id, document.updatedAt]);

  if (compact) {
    return (
      <span className="flex h-[58px] w-[46px] shrink-0 flex-col gap-1 rounded-[8px] border border-[#e5e7eb] bg-white px-1.5 py-[7px]" aria-hidden="true">
        <i className="block h-1 w-[70%] rounded bg-[#94a3b8]" />
        <i className="block h-1 rounded bg-[#e2e8f0]" />
        <i className="block h-1 rounded bg-[#e2e8f0]" />
        <i className="block h-1 rounded bg-[#e2e8f0]" />
      </span>
    );
  }

  const serif = { fontFamily: 'var(--font-serif), "Source Serif 4", Georgia, serif' };
  return (
    <div
      className={`overflow-hidden border-b border-[#f1f5f9] bg-[#f8fafc] ${small ? 'h-[116px] px-3.5 py-3' : 'h-[150px] px-[22px] py-[18px]'}`}
      aria-hidden="true"
    >
      <b className={`line-clamp-2 block font-bold leading-[1.3] text-[#0f172a] ${small ? 'mb-1.5 text-[12px]' : 'mb-2 text-[14px]'}`} style={serif}>
        {preview?.title || document.title || 'Untitled document'}
      </b>
      {preview?.text ? (
        <span className={`line-clamp-5 block leading-[1.5] text-[#64748b] ${small ? 'text-[9px]' : 'text-[10.5px]'}`} style={serif}>
          {preview.text}
        </span>
      ) : null}
    </div>
  );
}
