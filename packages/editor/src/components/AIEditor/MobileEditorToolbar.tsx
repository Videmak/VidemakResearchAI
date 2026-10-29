'use client';

import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import type { BlockNoteEditor } from '@blocknote/core';
import { LuAlignCenter, LuAlignJustify, LuAlignLeft, LuAlignRight, LuBold, LuIndentDecrease, LuIndentIncrease, LuItalic, LuList, LuListChecks, LuListOrdered, LuMessageSquarePlus, LuQuote, LuSeparatorHorizontal, LuStrikethrough, LuTable, LuUnderline, LuX } from 'react-icons/lu';
import { changeIndent } from '../../lib/aiEditor/paragraphFormat';

type DocsEditor = BlockNoteEditor<any, any, any>;

type MobileEditorToolbarProps = {
  editor: DocsEditor;
  surfaceRef: React.RefObject<HTMLElement | null>;
  enabled: boolean;
  onComment: () => void;
  onWriteWithAI?: () => void;
  onCite: () => void;
  /** "∑": an inline equation at the cursor. */
  onEquation?: () => void;
};

type SheetTab = 'text' | 'paragraph' | 'insert';

const TEXT_COLORS = [
  { id: 'default', label: 'Black', swatch: '#111827' },
  { id: 'red', label: 'Red', swatch: '#c5221f' },
  { id: 'blue', label: 'Blue', swatch: '#1a73e8' },
  { id: 'green', label: 'Green', swatch: '#188038' },
  { id: 'orange', label: 'Orange', swatch: '#e8710a' },
  { id: 'purple', label: 'Purple', swatch: '#8430ce' },
];

const BLOCK_STYLES: { label: string; type: string; level?: number; className: string }[] = [
  { label: 'Heading 1', type: 'heading', level: 1, className: 'text-[20px] font-bold' },
  { label: 'Heading 2', type: 'heading', level: 2, className: 'text-[17px] font-bold' },
  { label: 'Heading 3', type: 'heading', level: 3, className: 'text-[15px] font-bold' },
  { label: 'Normal text', type: 'paragraph', className: 'text-[15px]' },
];

/** Keeps the editor focused (and the keyboard up) when a toolbar button is pressed. */
const keepFocus = (event: React.PointerEvent | React.MouseEvent) => event.preventDefault();

function ToolButton({ label, active, onPress, children }: { label: string; active?: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={onPress}
      className={`inline-flex h-10 min-w-[40px] items-center justify-center rounded-[10px] ${active ? 'bg-[#eff6ff] text-[var(--theme-primary-dark)]' : 'text-[#334155]'}`}
    >
      {children}
    </button>
  );
}

/**
 * Phone editing toolbar, as in Docs and Word on phones: it sits on top of the
 * on-screen keyboard while the cursor is in the document. "Aa" opens a format
 * sheet with styles, paragraph settings and inserts.
 */
export default function MobileEditorToolbar({ editor, surfaceRef, enabled, onComment, onWriteWithAI, onCite, onEquation }: MobileEditorToolbarProps) {
  const [focused, setFocused] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [sheet, setSheet] = useState<SheetTab | null>(null);
  const [, setSelectionTick] = useState(0);

  useEffect(() => {
    const update = () => {
      const surface = surfaceRef.current;
      const active = document.activeElement;
      setFocused(Boolean(surface && active && surface.contains(active)));
    };
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, [surfaceRef]);

  // Stay above the on-screen keyboard (the visual viewport shrinks when it opens).
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setKeyboardInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);

  // Re-read bold/italic/list state as the cursor moves.
  useEffect(() => editor.onSelectionChange(() => setSelectionTick((tick) => tick + 1)), [editor]);

  const run = useCallback((action: (current: DocsEditor) => void) => {
    try {
      action(editor);
    } catch (error) {
      console.error('Phone toolbar action failed:', error);
    }
  }, [editor]);

  if (!enabled || (!focused && !sheet)) return null;

  let styles: Record<string, unknown> = {};
  let block: any = null;
  try {
    styles = editor.getActiveStyles() as Record<string, unknown>;
    block = editor.getTextCursorPosition().block;
  } catch {
    // The editor view can be briefly unavailable while a document loads.
  }
  const blockType: string = block?.type ?? 'paragraph';
  const blockLevel: number | undefined = block?.props?.level;
  const alignment: string = block?.props?.textAlignment ?? 'left';

  const toggleStyle = (style: 'bold' | 'italic' | 'underline' | 'strike') => run((current) => current.toggleStyles({ [style]: true } as any));
  const setBlockType = (type: string, props?: Record<string, unknown>) =>
    run((current) => {
      const target = current.getTextCursorPosition().block;
      current.updateBlock(target, { type, ...(props ? { props } : {}) } as any);
    });
  const toggleList = (type: 'bulletListItem' | 'numberedListItem' | 'checkListItem') =>
    setBlockType(blockType === type ? 'paragraph' : type);

  const bottom = keyboardInset;

  return (
    <div className="ai-editor-print-hidden fixed inset-x-0 z-[11800] md:hidden" style={{ bottom }}>
      {sheet ? (
        <div role="dialog" aria-label="Format" className="max-h-[50vh] overflow-y-auto rounded-t-[24px] border-t border-[#e5e7eb] bg-white px-3.5 pb-3 pt-3 shadow-[0_-10px_30px_-10px_rgba(15,23,42,.3)]">
          <div className="mb-3 flex items-center gap-2">
            <div className="grid flex-1 grid-cols-3 rounded-[12px] bg-[#f1f5f9] p-1">
              {(['text', 'paragraph', 'insert'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onPointerDown={keepFocus}
                  onMouseDown={keepFocus}
                  onClick={() => setSheet(tab)}
                  className={`h-9 rounded-[9px] text-[14.5px] font-semibold capitalize ${sheet === tab ? 'bg-white text-[#0f172a] shadow-[0_1px_3px_rgba(15,23,42,.12)]' : 'text-[#64748b]'}`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <ToolButton label="Close formatting" onPress={() => setSheet(null)}>
              <LuX className="h-5 w-5" />
            </ToolButton>
          </div>

          {sheet === 'text' ? (
            <div>
              {BLOCK_STYLES.map((style) => {
                const active = style.type === blockType && (style.level === undefined || style.level === blockLevel);
                return (
                  <button
                    key={style.label}
                    type="button"
                    onPointerDown={keepFocus}
                    onMouseDown={keepFocus}
                    onClick={() => setBlockType(style.type, style.level ? { level: style.level } : undefined)}
                    className={`flex w-full items-center rounded-[10px] px-3 py-2 text-left ${style.className} ${active ? 'bg-[#eff6ff] text-[var(--theme-primary-dark)]' : 'text-[#0f172a]'}`}
                    style={{ fontFamily: 'var(--font-serif), "Source Serif 4", Georgia, serif' }}
                  >
                    {style.label}
                  </button>
                );
              })}
              <div className="mt-2 grid grid-cols-4 overflow-hidden rounded-[12px] border border-[#e5e7eb]">
                <ToolButton label="Bold" active={Boolean(styles.bold)} onPress={() => toggleStyle('bold')}><LuBold className="h-5 w-5" /></ToolButton>
                <ToolButton label="Italic" active={Boolean(styles.italic)} onPress={() => toggleStyle('italic')}><LuItalic className="h-5 w-5" /></ToolButton>
                <ToolButton label="Underline" active={Boolean(styles.underline)} onPress={() => toggleStyle('underline')}><LuUnderline className="h-5 w-5" /></ToolButton>
                <ToolButton label="Strikethrough" active={Boolean(styles.strike)} onPress={() => toggleStyle('strike')}><LuStrikethrough className="h-5 w-5" /></ToolButton>
              </div>
              <div className="mt-3 flex items-center justify-between px-1">
                <span className="text-[14px] text-[#0f172a]">Text colour</span>
                <div className="flex gap-2">
                  {TEXT_COLORS.map((color) => {
                    const active = (styles.textColor ?? 'default') === color.id;
                    return (
                      <button
                        key={color.id}
                        type="button"
                        aria-label={color.label}
                        aria-pressed={active}
                        onPointerDown={keepFocus}
                        onMouseDown={keepFocus}
                        onClick={() => run((current) => (color.id === 'default' ? current.removeStyles({ textColor: 'default' } as any) : current.addStyles({ textColor: color.id } as any)))}
                        className="h-7 w-7 rounded-full"
                        style={{ backgroundColor: color.swatch, boxShadow: active ? '0 0 0 2px #fff, 0 0 0 4px #2563eb' : undefined }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          {sheet === 'paragraph' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-4 overflow-hidden rounded-[12px] border border-[#e5e7eb]">
                {[
                  { id: 'left', label: 'Align left', icon: <LuAlignLeft className="h-5 w-5" /> },
                  { id: 'center', label: 'Centre', icon: <LuAlignCenter className="h-5 w-5" /> },
                  { id: 'right', label: 'Align right', icon: <LuAlignRight className="h-5 w-5" /> },
                  { id: 'justify', label: 'Justify', icon: <LuAlignJustify className="h-5 w-5" /> },
                ].map((option) => (
                  <ToolButton
                    key={option.id}
                    label={option.label}
                    active={alignment === option.id}
                    onPress={() => run((current) => current.updateBlock(current.getTextCursorPosition().block, { props: { textAlignment: option.id } } as any))}
                  >
                    {option.icon}
                  </ToolButton>
                ))}
              </div>
              <div className="grid grid-cols-5 overflow-hidden rounded-[12px] border border-[#e5e7eb]">
                <ToolButton label="Bulleted list" active={blockType === 'bulletListItem'} onPress={() => toggleList('bulletListItem')}><LuList className="h-5 w-5" /></ToolButton>
                <ToolButton label="Numbered list" active={blockType === 'numberedListItem'} onPress={() => toggleList('numberedListItem')}><LuListOrdered className="h-5 w-5" /></ToolButton>
                <ToolButton label="Checklist" active={blockType === 'checkListItem'} onPress={() => toggleList('checkListItem')}><LuListChecks className="h-5 w-5" /></ToolButton>
                <ToolButton label="Decrease indent" onPress={() => run((current) => changeIndent(current, -1))}><LuIndentDecrease className="h-5 w-5" /></ToolButton>
                <ToolButton label="Increase indent" onPress={() => run((current) => changeIndent(current, 1))}><LuIndentIncrease className="h-5 w-5" /></ToolButton>
              </div>
            </div>
          ) : null}

          {sheet === 'insert' ? (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Citation', icon: <LuQuote className="h-6 w-6" />, onPress: () => { setSheet(null); onCite(); } },
                { label: 'Comment', icon: <LuMessageSquarePlus className="h-6 w-6" />, onPress: () => { setSheet(null); onComment(); } },
                {
                  label: 'Table',
                  icon: <LuTable className="h-6 w-6" />,
                  onPress: () => run((current) => {
                    const row = () => ({ cells: [[], [], []] });
                    current.insertBlocks(
                      [{ type: 'table', content: { type: 'tableContent', rows: [row(), row(), row()] } } as any],
                      current.getTextCursorPosition().block,
                      'after',
                    );
                  }),
                },
                {
                  label: 'Page break',
                  icon: <LuSeparatorHorizontal className="h-6 w-6" />,
                  onPress: () => run((current) => {
                    current.insertBlocks([{ type: 'pageBreak' } as any], current.getTextCursorPosition().block, 'after');
                  }),
                },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onPointerDown={keepFocus}
                  onMouseDown={keepFocus}
                  onClick={item.onPress}
                  className="flex flex-col items-center gap-1 rounded-[14px] border border-[#e5e7eb] py-3 text-[13px] font-semibold text-[#334155]"
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* The mockup's tool row over the keyboard: Aa · @ Cite · ∑ · ✦ AI … ⌄ */}
      <div className="flex items-center gap-1.5 border-t border-[#e5e7eb] bg-[#f8fafc] px-2.5 py-2">
        {[
          { key: 'format', label: 'Format', active: Boolean(sheet), onPress: () => setSheet((current) => (current ? null : 'text')), content: <span>Aa</span> },
          { key: 'cite', label: 'Insert citation', onPress: onCite, content: <><b className="font-extrabold text-[var(--theme-primary)]">@</b> Cite</> },
          ...(onEquation ? [{ key: 'equation', label: 'Insert equation', onPress: onEquation, content: <span>∑</span> }] : []),
        ].map((tool) => (
          <button
            key={tool.key}
            type="button"
            aria-label={tool.label}
            aria-pressed={'active' in tool ? tool.active : undefined}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={tool.onPress}
            className={`inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-[11px] border px-2.5 text-[14px] font-semibold ${
              'active' in tool && tool.active ? 'border-[#dbeafe] bg-[#eff6ff] text-[var(--theme-primary-dark)]' : 'border-[#e5e7eb] bg-white text-[#334155]'
            }`}
          >
            {tool.content}
          </button>
        ))}
        {onWriteWithAI ? (
          <button
            type="button"
            aria-label="AI tools"
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={onWriteWithAI}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[11px] border border-[var(--theme-primary)] bg-[var(--theme-primary)] px-2.5 text-[14px] font-semibold text-white"
          >
            ✦ AI
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Hide keyboard"
          onClick={() => {
            setSheet(null);
            (document.activeElement as HTMLElement | null)?.blur();
          }}
          className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-[11px] border border-[#e5e7eb] bg-white text-[#334155]"
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
    </div>
  );
}
