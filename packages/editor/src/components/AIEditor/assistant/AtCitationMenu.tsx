'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import type { BlockNoteEditor } from '@blocknote/core';
import type { Transaction } from '@tiptap/pm/state';
import { SuggestionMenuController, type SuggestionMenuProps } from '@blocknote/react';
import { LuGlobe, LuLibrary, LuLockOpen, LuPlus } from 'react-icons/lu';
import { formatCount } from './PaperCard';
import { paperAuthorsLabel, searchPapers, type Paper } from '../../../lib/aiEditor/assistApi';
import { getDocuments, type LibraryDocumentResponse } from '../../../utils/libraryApi';
import { libraryDocumentYear } from './LibraryPanel';
import type { AIEditorDocumentMember } from '../../../types/ai-editor';

type AtItem =
  | { kind: 'library'; key: string; document: LibraryDocumentResponse }
  | { kind: 'paper'; key: string; paper: Paper }
  | { kind: 'person'; key: string; member: AIEditorDocumentMember }
  | { kind: 'custom'; key: string }
  | { kind: 'more'; key: string; query: string };

const GROUP_LABEL: Record<AtItem['kind'], string> = {
  library: 'Your Library',
  paper: 'Papers',
  person: 'People',
  custom: '',
  more: '',
};

/** "@" opens the menu at the start of a paragraph or after a space, not inside an e-mail address. */
const opensAfterSpace = (tr: Transaction) => {
  const $from = tr.selection.$from;
  if ($from.parent.type.spec.code) return false;
  if ($from.parentOffset === 0) return true;
  const previous = $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset, undefined, '\ufffc');
  return /[\s(\[\u00a0]/.test(previous);
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function AtMenuList({ items, selectedIndex, onItemClick, loadingState }: SuggestionMenuProps<AtItem>) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  let lastGroup = '';
  return (
    <div ref={listRef} className="ce-at-menu w-[min(440px,calc(100vw-24px))] overflow-y-auto rounded-[14px] border border-[#e5e7eb] bg-white p-1 shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)]" style={{ maxHeight: 420 }}>
      {items.map((item, index) => {
        const group = GROUP_LABEL[item.kind];
        const header = group && group !== lastGroup ? group : '';
        lastGroup = group || lastGroup;
        const selected = index === selectedIndex;
        const base = `flex w-full items-start gap-2.5 rounded-[9px] px-2.5 py-2 text-left ${selected ? 'bg-[#eff6ff]' : 'hover:bg-[#f8fafc]'}`;
        return (
          <React.Fragment key={item.key}>
            {header ? <div className="px-2.5 pb-1 pt-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#94a3b8]">{header}</div> : null}
            <button type="button" data-index={index} className={base} onMouseDown={(event) => event.preventDefault()} onClick={() => onItemClick?.(item)}>
              {item.kind === 'paper' ? (
                <>
                  <LuGlobe className="mt-0.5 h-4 w-4 shrink-0 text-[#64748b]" />
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-[#0f172a]">{item.paper.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-[#64748b]">
                      <span>{paperAuthorsLabel(item.paper, 2)}{item.paper.year ? ` · ${item.paper.year}` : ''}</span>
                      {item.paper.source_name ? <span className="max-w-[180px] truncate italic">{item.paper.source_name}</span> : null}
                      {item.paper.cited_by_count ? <span>Cited by {formatCount(item.paper.cited_by_count)}</span> : null}
                      {item.paper.is_open_access ? <span className="inline-flex items-center gap-0.5 text-[#166534]"><LuLockOpen className="h-3 w-3" />OA</span> : null}
                    </span>
                  </span>
                </>
              ) : item.kind === 'library' ? (
                <>
                  <LuLibrary className="mt-0.5 h-4 w-4 shrink-0 text-[var(--theme-primary)]" />
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-[#0f172a]">{item.document.title || item.document.filename}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-[#64748b]">
                      {(item.document.authors || []).slice(0, 2).join(', ') || 'Unknown authors'}
                      {libraryDocumentYear(item.document) ? ` · ${libraryDocumentYear(item.document)}` : ''}
                    </span>
                  </span>
                </>
              ) : item.kind === 'person' ? (
                <>
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2563eb] text-[9px] font-semibold text-white">
                    {(item.member.displayName || item.member.email).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-[#0f172a]">{item.member.displayName}</span>
                    <span className="block truncate text-[12px] text-[#64748b]">{item.member.email}</span>
                  </span>
                </>
              ) : item.kind === 'more' ? (
                <span className="text-[12.5px] font-medium text-[var(--theme-primary)]">Search more papers for “{item.query}”…</span>
              ) : (
                <>
                  <LuPlus className="mt-0.5 h-4 w-4 shrink-0 text-[#64748b]" />
                  <span className="text-[13px] text-[#0f172a]">Add custom citation…</span>
                </>
              )}
            </button>
          </React.Fragment>
        );
      })}
      {loadingState !== 'loaded' ? (
        <div className="flex items-center gap-2 px-3.5 py-2 text-[12px] text-[#64748b]">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#e5e7eb] border-t-[var(--theme-primary)]" /> Searching papers…
        </div>
      ) : null}
    </div>
  );
}

/**
 * "@" in the document: cite from the Library or from 250M+ papers, mention a collaborator,
 * or add a custom citation.
 */
export default function AtCitationMenu({
  editor,
  members,
  enabled,
  onCitePaper,
  onCiteLibrary,
  onCustomCitation,
  onMorePapers,
}: {
  editor: BlockNoteEditor<any, any, any>;
  members: AIEditorDocumentMember[];
  enabled: boolean;
  onCitePaper: (paper: Paper) => void;
  onCiteLibrary: (document: LibraryDocumentResponse) => void;
  onCustomCitation: () => void;
  onMorePapers: (query: string) => void;
}) {
  const latest = useRef(0);
  const handlers = useRef({ onCitePaper, onCiteLibrary, onCustomCitation, onMorePapers });
  handlers.current = { onCitePaper, onCiteLibrary, onCustomCitation, onMorePapers };
  const membersRef = useRef(members);
  membersRef.current = members;

  const getItems = useCallback(async (rawQuery: string): Promise<AtItem[]> => {
    const query = rawQuery.trim();
    const request = ++latest.current;
    const people: AtItem[] = membersRef.current
      .filter((member, index, all) => all.findIndex((other) => other.email.toLowerCase() === member.email.toLowerCase()) === index)
      .filter((member) => !query || `${member.displayName} ${member.email}`.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 3)
      .map((member) => ({ kind: 'person', key: `person-${member.id}`, member }));
    await sleep(query.length >= 3 ? 300 : 120);
    if (request !== latest.current) return [];
    const [library, papers] = await Promise.all([
      getDocuments({ search: query || undefined, page_size: 4, order_by: 'created_at', order_desc: true })
        .then((response) => response.documents)
        .catch(() => [] as LibraryDocumentResponse[]),
      query.length >= 3 ? searchPapers(query, { perPage: 6 }).then((response) => response.results).catch(() => [] as Paper[]) : Promise.resolve([] as Paper[]),
    ]);
    return [
      ...library.map((document): AtItem => ({ kind: 'library', key: `lib-${document.id}`, document })),
      ...papers.map((paper): AtItem => ({ kind: 'paper', key: `paper-${paper.id || paper.doi}`, paper })),
      ...(query.length >= 3 ? [{ kind: 'more', key: 'more', query } as AtItem] : []),
      ...people,
      { kind: 'custom', key: 'custom' },
    ];
  }, []);

  const onItemClick = useCallback((item: AtItem) => {
    const { onCitePaper, onCiteLibrary, onCustomCitation, onMorePapers } = handlers.current;
    if (item.kind === 'paper') onCitePaper(item.paper);
    else if (item.kind === 'library') onCiteLibrary(item.document);
    else if (item.kind === 'custom') onCustomCitation();
    else if (item.kind === 'more') onMorePapers(item.query);
    else if (item.kind === 'person') {
      editor.insertInlineContent([
        {
          type: 'aiMention',
          props: { memberId: item.member.id, displayName: item.member.displayName, email: item.member.email, role: item.member.role, color: '#2563eb' },
        } as any,
        ' ',
      ]);
    }
  }, [editor]);

  if (!enabled) return null;
  return (
    <SuggestionMenuController
      triggerCharacter="@"
      shouldOpen={opensAfterSpace}
      minQueryLength={0}
      getItems={getItems}
      onItemClick={onItemClick}
      suggestionMenuComponent={AtMenuList}
    />
  );
}
