'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createReactBlockSpec } from '@blocknote/react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { sanitize } from '../../helpers/sanitize';

/**
 * TeX equations: a display equation block and the editor popover shared with inline math
 * (aiMath). Word export writes them as Word equations (OMML); LaTeX export as equation*.
 */

export function renderTex(latex: string, displayMode: boolean) {
  if (!latex.trim()) return '';
  try {
    return sanitize(katex.renderToString(latex, { throwOnError: false, displayMode, strict: 'ignore' }));
  } catch {
    return '';
  }
}

const SNIPPETS = ['\\frac{a}{b}', 'x^{2}', 'x_{i}', '\\sqrt{x}', '\\sum_{i=1}^{n}', '\\int_{a}^{b}', '\\alpha', '\\beta', '\\pm', '\\leq', '\\geq', '\\times'];

// One equation editor at a time: opening another closes the one already open.
let closeOpenEditor: (() => void) | null = null;

export function EquationEditor({
  initial,
  displayMode,
  anchor,
  onSave,
  onCancel,
  onRemove,
}: {
  initial: string;
  displayMode: boolean;
  anchor: DOMRect;
  onSave: (latex: string) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (closeOpenEditor) closeOpenEditor();
    closeOpenEditor = onCancel;
    return () => {
      if (closeOpenEditor === onCancel) closeOpenEditor = null;
    };
  }, [onCancel]);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onCancel();
    };
    const timer = window.setTimeout(() => window.addEventListener('pointerdown', onPointer, true), 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [onCancel]);
  const width = Math.min(460, window.innerWidth - 16);
  const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 8));
  const top = anchor.bottom + 260 > window.innerHeight ? Math.max(8, anchor.top - 268) : anchor.bottom + 8;
  const preview = renderTex(value, displayMode);
  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top, left, width, zIndex: 12700 }}
      className="rounded-[14px] border border-[#e5e7eb] bg-white p-3 shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)]"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || !event.shiftKey)) {
          event.preventDefault();
          onSave(value.trim());
        }
      }}
    >
      <div className="mb-1.5 text-[12px] font-semibold text-[#334155]">{displayMode ? 'Equation' : 'Inline equation'} (TeX)</div>
      <textarea
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={2}
        spellCheck={false}
        aria-label="TeX"
        placeholder="E = mc^2"
        className="block w-full resize-none rounded-[10px] border border-[#e5e7eb] px-3 py-2 font-mono text-[13px] outline-none focus:border-[var(--theme-primary,#2563eb)] focus:shadow-[0_0_0_4px_#eff6ff]"
      />
      <div className="mt-1.5 flex flex-wrap gap-1">
        {SNIPPETS.map((snippet) => (
          <button
            key={snippet}
            type="button"
            onClick={() => {
              setValue((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${snippet}`);
              inputRef.current?.focus();
            }}
            className="rounded-md bg-[#f1f5f9] px-1.5 py-0.5 font-mono text-[11px] text-[#334155] hover:bg-[#e2e8f0]"
          >
            {snippet}
          </button>
        ))}
      </div>
      <div className="mt-2 min-h-[44px] overflow-x-auto rounded-xl bg-[#f8fafc] px-3 py-2 text-center" dangerouslySetInnerHTML={{ __html: preview || '<span style="color:#94a3b8;font-size:12px">Preview</span>' }} />
      <div className="mt-2.5 flex items-center justify-between">
        {onRemove ? (
          <button type="button" onClick={onRemove} className="h-8 rounded-[9px] px-3 text-[12.5px] font-semibold text-[#b91c1c] hover:bg-[#fef2f2]">Remove</button>
        ) : <span />}
        <div className="flex gap-1.5">
          <button type="button" onClick={onCancel} className="h-8 rounded-[9px] border border-[#e5e7eb] bg-white px-3 text-[12.5px] font-semibold text-[#334155] hover:bg-[#f8fafc]">Cancel</button>
          <button type="button" onClick={() => onSave(value.trim())} className="h-8 rounded-[10px] bg-[var(--theme-primary,#2563eb)] shadow-[0_6px_16px_-8px_rgba(37,99,235,0.8)] px-4 text-[12.5px] font-semibold text-white">Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function EquationBlockView({ block, editor }: { block: any; editor: any }) {
  const latex = String(block.props.latex || '');
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const html = renderTex(latex, true);
  // Read on click, not on render: blocks render before the editor is made editable.
  const open = (element: HTMLElement) => editor.isEditable && setAnchor(element.getBoundingClientRect());
  const close = React.useCallback(() => setAnchor(null), []);
  // A new, empty equation opens its editor straight away.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!latex && ref.current && block.props.autoOpen !== 'false') open(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={ref}
      className="ce-equation-block"
      contentEditable={false}
      role="button"
      tabIndex={0}
      aria-label="Equation"
      data-latex={latex}
      // On mouse down: the editor's own handling (selecting the block) re-renders it before a
      // click could arrive, so a click alone needed a second try.
      onMouseDown={(event) => {
        if (event.button !== 0 || !editor.isEditable || anchor) return;
        event.preventDefault();
        open(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          open(event.currentTarget);
        }
      }}
    >
      {html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <span className="text-[13px] text-[#94a3b8]">Click to add an equation</span>}
      {anchor ? (
        <EquationEditor
          initial={latex}
          displayMode
          anchor={anchor}
          onCancel={close}
          onSave={(next) => {
            setAnchor(null);
            editor.updateBlock(block, { props: { latex: next, autoOpen: 'false' } });
          }}
          onRemove={() => {
            setAnchor(null);
            editor.removeBlocks([block]);
          }}
        />
      ) : null}
    </div>
  );
}

export const equationBlockSpec = createReactBlockSpec(
  { type: 'equation', propSchema: { latex: { default: '' }, autoOpen: { default: 'true' } }, content: 'none' },
  {
    render: ({ block, editor }) => <EquationBlockView block={block} editor={editor} />,
    toExternalHTML: ({ block }) => (
      <div data-content-type="equation" data-latex={block.props.latex} dangerouslySetInnerHTML={{ __html: renderTex(String(block.props.latex || ''), true) }} />
    ),
    parse: (element) => (element.getAttribute('data-content-type') === 'equation' ? { latex: element.getAttribute('data-latex') || '', autoOpen: 'false' } : undefined),
  },
);

export const EQUATION_CSS = `
  .ce-equation-block { display: block; width: 100%; padding: 10px 8px; margin: 4px 0; text-align: center; border-radius: 8px; overflow-x: auto; }
  [contenteditable="true"] .ce-equation-block { cursor: pointer; }
  [contenteditable="true"] .ce-equation-block:hover { background: #f8fafc; }
  .ce-equation-block .katex-display { margin: 0; }
  [data-inline-content-type="aiMath"] { cursor: pointer; border-radius: 4px; }
  [data-inline-content-type="aiMath"]:hover { background: #f1f5f9; }
`;
