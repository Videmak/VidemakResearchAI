'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SideMenuExtension } from '@blocknote/core/extensions';
import {
  AddBlockButton,
  DragHandleButton,
  SideMenu,
  SideMenuController,
  useComponentsContext,
  useExtension,
  useExtensionState,
  type SideMenuProps,
} from '@blocknote/react';
import { LuArrowUp, LuClipboardCheck, LuGlobe, LuLibrary, LuMessageCircle, LuMessageSquarePlus, LuQuote, LuSparkles, LuWandSparkles, LuX } from 'react-icons/lu';
import CreditsUpsell from './CreditsUpsell';
import { AssistError, aiEdit, type AssistSource } from '../../../lib/aiEditor/assistApi';
import { countWords, previewAIText, serializeInlineForAI, visibleText } from '../../../lib/aiEditor/aiText';
import { getDocuments, type LibraryDocumentResponse } from '../../../utils/libraryApi';

export type BlockAIAction = 'edit' | 'citations' | 'chat' | 'comment' | 'review';

/** Paragraph-like blocks the AI tools work on. */
export const AI_BLOCK_TYPES = new Set(['paragraph', 'heading', 'quote', 'bulletListItem', 'numberedListItem', 'checkListItem']);

// ------------------------------------------------------------------ side menu

function AIButton({ onOpen }: { onOpen: (blockId: string, anchor: DOMRect) => void }) {
  const Components = useComponentsContext()!;
  const sideMenu = useExtension(SideMenuExtension);
  const block = useExtensionState(SideMenuExtension, { selector: (state) => state?.block });
  if (!block || !AI_BLOCK_TYPES.has(block.type) || !Array.isArray(block.content) || block.content.length === 0) return null;
  return (
    <Components.SideMenu.Button
      label="AI tools for this paragraph"
      className="bn-button ce-side-ai"
      icon={
        <span
          data-test="blockAI"
          className="ce-side-ai-glyph"
          aria-hidden="true"
          onClick={(event: React.MouseEvent) => {
            sideMenu.freezeMenu();
            onOpen(block.id, (event.currentTarget as Element).getBoundingClientRect());
          }}
        >
          ✦
        </span>
      }
    />
  );
}

/** The mockup's gutter: three 26px squares, "+", drag and the AI "✦" on a brand tint. */
const GUTTER_CSS = `
.bn-container .bn-side-menu { gap: 2px; align-items: center; }
.bn-container .bn-side-menu .bn-button {
  width: 26px !important; min-width: 26px !important; height: 26px !important; min-height: 26px !important;
  padding: 0 !important; border-radius: 7px !important; color: #94a3b8 !important; background: transparent !important;
  display: grid !important; place-items: center !important;
}
.bn-container .bn-side-menu .bn-button:hover { background: #f1f5f9 !important; color: #334155 !important; }
.bn-container .bn-side-menu .bn-button svg { width: 18px !important; height: 18px !important; color: inherit !important; }
.bn-container .bn-side-menu .bn-button.ce-side-ai { color: var(--theme-primary, #2563eb) !important; background: #eff6ff !important; }
.bn-container .bn-side-menu .bn-button.ce-side-ai:hover { background: #dbeafe !important; }
.bn-container .bn-side-menu .ce-side-ai-glyph { display: grid; place-items: center; width: 26px; height: 26px; font-size: 14px; line-height: 1; cursor: pointer; }
`;

/** BlockNote's side menu (+, drag) with the ✦ AI button next to the text, as in the mockup. */
export function BlockSideMenu({ onOpenAI }: { onOpenAI: (blockId: string, anchor: DOMRect) => void }) {
  const Menu = useCallback(
    (props: SideMenuProps) => (
      <SideMenu {...props}>
        <AddBlockButton />
        <DragHandleButton {...props} />
        <AIButton onOpen={onOpenAI} />
      </SideMenu>
    ),
    [onOpenAI],
  );
  return (
    <>
      <style>{GUTTER_CSS}</style>
      <SideMenuController sideMenu={Menu} />
    </>
  );
}

/** Releases BlockNote's side menu after our popover closes. */
export function useUnfreezeSideMenu(editor: any) {
  return useCallback(() => {
    try {
      editor?.getExtension?.(SideMenuExtension)?.unfreezeMenu?.();
    } catch {
      /* the menu is gone with the editor */
    }
  }, [editor]);
}

// ------------------------------------------------------------------ positioning

function useAnchoredStyle(anchor: DOMRect | null, width: number, gap = 6) {
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    if (!anchor) return;
    const viewportWidth = window.innerWidth;
    const left = Math.max(8, Math.min(anchor.left, viewportWidth - width - 8));
    const below = anchor.bottom + gap;
    const top = below + 260 > window.innerHeight ? Math.max(8, anchor.top - gap - 260) : below;
    setStyle({ position: 'fixed', top, left, width: Math.min(width, viewportWidth - 16), zIndex: 12600 });
  }, [anchor, gap, width]);
  return style;
}

function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    const timer = window.setTimeout(() => window.addEventListener('pointerdown', onPointer, true), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, ref]);
}

// ------------------------------------------------------------------ block menu

export function BlockAIMenu({
  anchor,
  onAction,
  onClose,
  canEdit,
  canComment,
}: {
  anchor: DOMRect;
  /** Kept for callers; the menu no longer shows it. */
  words?: number;
  onAction: (action: BlockAIAction) => void;
  onClose: () => void;
  canEdit: boolean;
  canComment: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const style = useAnchoredStyle(anchor, 200);
  const items: { action: BlockAIAction; label: string; icon: React.ReactNode; show: boolean }[] = [
    { action: 'edit', label: 'Edit with AI', icon: <LuWandSparkles className="h-4 w-4" />, show: canEdit },
    { action: 'citations', label: 'Find citations', icon: <LuQuote className="h-4 w-4" />, show: canEdit },
    { action: 'chat', label: 'Ask AI', icon: <LuMessageCircle className="h-4 w-4" />, show: true },
    { action: 'review', label: 'Review', icon: <LuClipboardCheck className="h-4 w-4" />, show: canComment },
    { action: 'comment', label: 'Comment', icon: <LuMessageSquarePlus className="h-4 w-4" />, show: canComment },
  ];
  return createPortal(
    <div ref={ref} role="menu" aria-label="AI tools" style={style} className="overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white p-1 shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)]">
      {items.filter((item) => item.show).map((item) => (
        <button
          key={item.action}
          type="button"
          role="menuitem"
          onClick={() => onAction(item.action)}
          className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-[7px] text-left text-[13.5px] text-[#334155] hover:bg-[#f8fafc] hover:text-[#0f172a]"
        >
          <span className="text-[#94a3b8]">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ AI Edit

const QUICK_EDITS = [
  { label: 'Improve', instruction: 'Improve the writing: clearer, more precise, better flow. Keep the meaning.' },
  { label: 'Shorten', instruction: 'Make it more concise without losing key information.' },
  { label: 'Expand', instruction: 'Expand it with more detail and explanation, in the same voice.' },
  { label: 'More academic', instruction: 'Rewrite it in a formal academic register.' },
  { label: 'Fix grammar', instruction: 'Fix grammar, spelling and punctuation only. Change nothing else.' },
  { label: 'Add citations', instruction: 'Keep the text but add citations from the sources where claims need support.' },
];

export type AIEditResult = { text: string; sources: AssistSource[]; items: Map<string, any> };

const EDIT_GHOST = 'h-8 rounded-lg px-2.5 text-[13px] font-medium text-[#475569] hover:bg-[#f1f5f9] hover:text-[#0f172a] disabled:opacity-60';

export function AIEditBox({
  anchor,
  block,
  documentTitle,
  contextBefore,
  contextAfter,
  onApply,
  onClose,
  isMobile,
}: {
  anchor: DOMRect;
  block: { id: string; content: any };
  documentTitle?: string;
  contextBefore: string;
  contextAfter: string;
  onApply: (result: AIEditResult, mode: 'replace' | 'below') => void;
  onClose: () => void;
  isMobile?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const style = useAnchoredStyle(anchor, isMobile ? 560 : 520, 8);
  const [instruction, setInstruction] = useState('');
  const [useWeb, setUseWeb] = useState(false);
  const [useLibrary, setUseLibrary] = useState(false);
  const [mentions, setMentions] = useState<{ id: string; title: string }[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<LibraryDocumentResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [result, setResult] = useState<AIEditResult | null>(null);
  const [lastInstruction, setLastInstruction] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const serialized = useMemo(() => serializeInlineForAI(block.content), [block.content]);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (mentionQuery === null) return;
    const timer = window.setTimeout(() => {
      getDocuments({ search: mentionQuery || undefined, page_size: 5, order_by: 'created_at', order_desc: true })
        .then((response) => setMentionResults(response.documents))
        .catch(() => setMentionResults([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [mentionQuery]);

  const run = async (text: string) => {
    const value = text.trim();
    if (!value || loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setLastInstruction(value);
    const citing = /cit(e|ation)/i.test(value);
    try {
      const response = await aiEdit(
        {
          text: serialized.text,
          instruction: value,
          documentTitle,
          before: contextBefore,
          after: contextAfter,
          sources: {
            useWeb: useWeb || (citing && !useLibrary && !mentions.length),
            useLibrary: useLibrary || mentions.length > 0,
            libraryDocumentIds: mentions.map((mention) => mention.id),
          },
        },
        controller.signal,
      );
      setResult({ text: response.text, sources: response.sources, items: serialized.items });
      window.dispatchEvent(new CustomEvent('credits-updated'));
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') return;
      if (caught instanceof AssistError && caught.outOfCredits) setOutOfCredits(true);
      else setError((caught as Error).message || 'AI Edit failed.');
    } finally {
      setLoading(false);
    }
  };

  const preview = result ? previewAIText(result.text, result.items, result.sources) : '';

  return createPortal(
    <div ref={ref} style={style} className="ce-ai-edit-box rounded-[14px] border border-[#e5e7eb] bg-white p-2 shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)]">
      {result ? (
        <div className="p-1">
          <div className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-[10px] bg-[#f8fafc] px-3 py-2.5 text-[14.5px] leading-[1.6] text-[#1e293b]" style={{ fontFamily: "var(--font-serif), 'Source Serif 4', Georgia, serif" }}>{preview}</div>
          {result.sources.length ? <div className="mt-1.5 px-1 text-[12px] text-[#64748b]">Adds {result.sources.length} citation{result.sources.length === 1 ? '' : 's'}</div> : null}
          <div className="mt-2 flex flex-wrap items-center gap-0.5">
            <button type="button" onClick={() => onApply(result, 'replace')} className="mr-1 h-8 rounded-lg bg-[var(--theme-primary,#2563eb)] px-3 text-[13px] font-semibold text-white hover:bg-[#1d4ed8]">Replace</button>
            <button type="button" onClick={() => onApply(result, 'below')} className={EDIT_GHOST}>Insert below</button>
            <button type="button" onClick={() => void run(lastInstruction)} disabled={loading} className={EDIT_GHOST}>{loading ? 'Rewriting…' : 'Retry'}</button>
            <button type="button" onClick={() => setResult(null)} className={`${EDIT_GHOST} ml-auto`}>Discard</button>
          </div>
        </div>
      ) : (
        <div>
          {mentions.length ? (
            <div className="mb-1 flex flex-wrap gap-1 px-1">
              {mentions.map((mention) => (
                <span key={mention.id} className="inline-flex max-w-[220px] items-center gap-1 rounded-md bg-[#eff6ff] px-1.5 py-0.5 text-[12px] font-medium text-[#1d4ed8]">
                  <span className="truncate">@{mention.title}</span>
                  <button type="button" aria-label="Remove" onClick={() => setMentions((current) => current.filter((item) => item.id !== mention.id))}><LuX className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="relative flex items-start gap-2 rounded-[10px] px-1.5 py-1">
            {mentionQuery !== null && mentionResults.length ? (
              <div className="absolute inset-x-0 bottom-full z-10 mb-2 overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white p-1 shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)]">
                {mentionResults.map((document) => (
                  <button
                    key={document.id}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setMentions((current) => (current.some((item) => item.id === document.id) ? current : [...current, { id: document.id, title: document.title || document.filename }]));
                      setInstruction((current) => current.replace(/(?:^|\s)@([^\s@]*)$/, (match) => (match.startsWith(' ') ? ' ' : '')));
                      setMentionQuery(null);
                      setUseLibrary(true);
                    }}
                    className="block w-full truncate rounded-[8px] px-3 py-2 text-left text-[13.5px] text-[#0f172a] hover:bg-[#f8fafc]"
                  >
                    {document.title || document.filename}
                  </button>
                ))}
              </div>
            ) : null}
            <LuSparkles className={`mt-[7px] h-4 w-4 shrink-0 text-[var(--theme-primary,#2563eb)] ${loading ? 'animate-pulse' : ''}`} />
            <textarea
              autoFocus
              value={instruction}
              onChange={(event) => {
                setInstruction(event.target.value);
                const match = /(?:^|\s)@([^\s@]*)$/.exec(event.target.value);
                setMentionQuery(match ? match[1] : null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void run(instruction);
                }
              }}
              rows={1}
              placeholder={loading ? 'Rewriting…' : 'Tell AI what to change…'}
              aria-label="AI Edit instruction"
              className="block min-h-[30px] w-full resize-none bg-transparent py-[5px] text-[14px] text-[#0f172a] outline-none placeholder:text-[#94a3b8]"
            />
            <button
              type="button"
              aria-label="Edit"
              disabled={!instruction.trim() || loading}
              onClick={() => void run(instruction)}
              className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--theme-primary,#2563eb)] text-white hover:bg-[#1d4ed8] disabled:bg-[#e2e8f0] disabled:text-[#94a3b8]"
            >
              <LuArrowUp className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 border-t border-[#f1f5f9] px-1 pt-2">
            {QUICK_EDITS.map((quick) => (
              <button
                key={quick.label}
                type="button"
                disabled={loading}
                onClick={() => {
                  if (quick.label === 'Add citations' && !useLibrary && !mentions.length) setUseWeb(true);
                  void run(quick.instruction);
                }}
                className="inline-flex h-7 items-center rounded-lg bg-[#f8fafc] px-2.5 text-[12.5px] font-medium text-[#334155] hover:bg-[#eff6ff] hover:text-[#1d4ed8] disabled:opacity-50"
              >
                {quick.label}
              </button>
            ))}
            <span className="ml-auto flex items-center gap-0.5">
              <button type="button" aria-pressed={useWeb} title={useWeb ? 'Using web papers' : 'Not using web papers'} onClick={() => setUseWeb((value) => !value)} className={`grid h-7 w-7 place-items-center rounded-lg ${useWeb ? 'bg-[#eff6ff] text-[#1d4ed8]' : 'text-[#94a3b8] hover:bg-[#f8fafc] hover:text-[#334155]'}`}>
                <LuGlobe className="h-3.5 w-3.5" />
              </button>
              <button type="button" aria-pressed={useLibrary} title={useLibrary ? 'Using your Library' : 'Not using your Library'} onClick={() => setUseLibrary((value) => !value)} className={`grid h-7 w-7 place-items-center rounded-lg ${useLibrary ? 'bg-[#eff6ff] text-[#1d4ed8]' : 'text-[#94a3b8] hover:bg-[#f8fafc] hover:text-[#334155]'}`}>
                <LuLibrary className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
          {loading ? <div className="mx-1 mt-2 h-0.5 overflow-hidden rounded-full bg-[#eff6ff]"><div className="h-full w-1/3 animate-[ce-progress_1.2s_ease-in-out_infinite] rounded-full bg-[var(--theme-primary,#2563eb)]" /></div> : null}
        </div>
      )}
      {error ? <div className="mt-2 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-3 py-1.5 text-[13px] text-[#991b1b]">{error}</div> : null}
      {outOfCredits ? <div className="mt-2"><CreditsUpsell feature="AI Edit" isMobile={isMobile} onDismiss={() => setOutOfCredits(false)} /></div> : null}
    </div>,
    document.body,
  );
}

export function blockWords(content: unknown) {
  return countWords(visibleText(content));
}
