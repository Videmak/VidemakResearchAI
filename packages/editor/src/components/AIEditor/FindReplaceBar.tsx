'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TextSelection } from '@tiptap/pm/state';
import { LuChevronDown, LuChevronUp, LuX } from 'react-icons/lu';
import { safeView } from '../../lib/aiEditor/editorPlugins';
import { findKey, findMatches, type FindState } from '../../lib/aiEditor/find';

export { FIND_CSS } from '../../lib/aiEditor/find';

/** Find (and replace) in the document, as in Docs: highlights, "2 of 7", next/previous. */

export default function FindReplaceBar({
  editor,
  initialQuery,
  replace,
  canEdit,
  onClose,
}: {
  editor: any;
  initialQuery: string;
  replace: boolean;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [showReplace, setShowReplace] = useState(replace && canEdit);
  const [state, setState] = useState<FindState>({ matches: [], current: -1 });
  const inputRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  useEffect(() => setShowReplace(replace && canEdit), [canEdit, replace]);
  // Stay clear of the assistant panel on the right when it is open (desktop).
  const [rightOffset, setRightOffset] = useState<number | null>(null);
  useEffect(() => {
    const update = () => {
      if (window.innerWidth < 768) {
        setRightOffset(null);
        return;
      }
      const panel = document.querySelector<HTMLElement>('.ce-assistant-panel');
      const next = (panel ? Math.round(panel.getBoundingClientRect().width) : 0) + 24;
      setRightOffset((current) => (current === next ? current : next));
    };
    update();
    const timer = window.setInterval(update, 800);
    window.addEventListener('resize', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', update);
    };
  }, []);

  const publish = useCallback((next: FindState, scroll: boolean) => {
    const view = safeView(editor);
    setState(next);
    if (!view || !findKey.get(view.state)) return;
    const tr = view.state.tr.setMeta(findKey, next).setMeta('addToHistory', false);
    const match = next.matches[next.current];
    if (match && scroll) {
      tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView();
    }
    view.dispatch(tr);
  }, [editor]);

  // Re-search when the query or options change (and after edits, so counts stay right).
  const search = useCallback((scroll: boolean, keepIndex = false) => {
    const view = safeView(editor);
    if (!view) return;
    const matches = findMatches(view.state, query, matchCase);
    const from = view.state.selection.from;
    const current = !matches.length ? -1 : keepIndex
      ? Math.min(Math.max(0, state.current), matches.length - 1)
      : Math.max(0, matches.findIndex((match) => match.from >= from));
    publish({ matches, current }, scroll);
  }, [editor, matchCase, publish, query, state.current]);

  useEffect(() => {
    const timer = window.setTimeout(() => search(true), 120);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, matchCase]);

  useEffect(() => {
    if (!editor?.onChange) return undefined;
    return editor.onChange(() => search(false, true));
  }, [editor, search]);

  // Leaving clears the highlights (the plugin goes with the bar).
  useEffect(() => () => {
    const view = safeView(editor);
    if (view && findKey.get(view.state)) view.dispatch(view.state.tr.setMeta(findKey, { matches: [], current: -1 }));
  }, [editor]);

  const step = (direction: 1 | -1) => {
    if (!state.matches.length) return;
    const current = (state.current + direction + state.matches.length) % state.matches.length;
    publish({ matches: state.matches, current }, true);
  };

  const replaceOne = () => {
    const view = safeView(editor);
    const match = state.matches[state.current];
    if (!view || !match || !canEdit) return;
    view.dispatch(view.state.tr.insertText(replacement, match.from, match.to));
    window.setTimeout(() => search(true, true), 0);
  };

  const replaceAll = () => {
    const view = safeView(editor);
    if (!view || !state.matches.length || !canEdit) return;
    const tr = view.state.tr;
    [...state.matches].sort((a, b) => b.from - a.from).forEach((match) => tr.insertText(replacement, match.from, match.to));
    view.dispatch(tr);
    window.setTimeout(() => search(false), 0);
  };

  const label = useMemo(() => {
    if (!query) return '';
    if (!state.matches.length) return 'No results';
    return `${state.current + 1} of ${state.matches.length}`;
  }, [query, state]);

  return (
    <div
      role="search"
      aria-label="Find in document"
      className="ce-find-bar fixed right-4 top-[64px] z-[12300] w-[min(420px,calc(100vw-32px))] rounded-[14px] border border-[#e5e7eb] bg-white p-2.5 shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)] md:top-[120px]"
      style={rightOffset !== null ? { right: rightOffset } : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                step(event.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Find in document"
            aria-label="Find"
            className="h-9 w-full rounded-[10px] border border-[#e5e7eb] pl-3 pr-20 text-[14px] outline-none focus:border-[var(--theme-primary,#2563eb)] focus:shadow-[0_0_0_4px_#eff6ff]"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11.5px] text-[#64748b]">{label}</span>
        </div>
        <button type="button" aria-label="Previous match" onClick={() => step(-1)} className="rounded-[8px] p-1.5 text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0f172a]"><LuChevronUp className="h-5 w-5" /></button>
        <button type="button" aria-label="Next match" onClick={() => step(1)} className="rounded-[8px] p-1.5 text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0f172a]"><LuChevronDown className="h-5 w-5" /></button>
        <button type="button" aria-label="Close find" onClick={onClose} className="rounded-[8px] p-1.5 text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0f172a]"><LuX className="h-5 w-5" /></button>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-[12px] text-[#334155]">
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" className="accent-[var(--theme-primary,#2563eb)]" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} /> Match case
        </label>
        {canEdit && !showReplace ? (
          <button type="button" onClick={() => setShowReplace(true)} className="font-medium text-[var(--theme-primary)] hover:underline">Replace…</button>
        ) : null}
      </div>
      {showReplace ? (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                replaceOne();
              }
            }}
            placeholder="Replace with"
            aria-label="Replace with"
            className="h-9 min-w-0 flex-1 rounded-[10px] border border-[#e5e7eb] px-3 text-[14px] outline-none focus:border-[var(--theme-primary,#2563eb)] focus:shadow-[0_0_0_4px_#eff6ff]"
          />
          <button type="button" disabled={!state.matches.length} onClick={replaceOne} className="h-9 rounded-[10px] border border-[#e5e7eb] bg-white px-3 text-[13px] font-semibold text-[#0f172a] hover:bg-[#f8fafc] disabled:opacity-50">Replace</button>
          <button type="button" disabled={!state.matches.length} onClick={replaceAll} className="h-9 rounded-[10px] bg-[var(--theme-primary,#2563eb)] shadow-[0_6px_16px_-8px_rgba(37,99,235,0.8)] px-3 text-[13px] font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-50">Replace all</button>
        </div>
      ) : null}
    </div>
  );
}
