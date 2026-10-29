'use client';

import { createStyleSpec } from '@blocknote/core';
import { createReactBlockSpec, createReactInlineContentSpec, useEditorChange } from '@blocknote/react';
import { useEffect, useRef, useState } from 'react';

/**
 * Word compatibility in the editor's own model. Paragraph-like blocks carry Word's paragraph
 * formatting as props (written back to Word on export), footnotes are inline content,
 * tracked changes are styles and the table of contents is a block. The converter
 * (workers/convert) turns Word files into this model and back.
 */

export const WORD_BLOCK_PROPS = {
  spaceBefore: { default: '' },
  spaceAfter: { default: '' },
  lineSpacing: { default: '' },
  indentLeft: { default: '' },
  indentRight: { default: '' },
  indentFirst: { default: '' },
  wordStyle: { default: '' },
  wordNumId: { default: '' },
  /** Set on blocks the app maintains itself ("bibliography" heading, "bibliography-entry" paragraphs). */
  ceRole: { default: '' },
} as const;

/** Word's "single" line for common fonts is about 1.15 em. */
export const WORD_LINE_FACTOR = 1.15;

export function cssLineHeight(value: string | undefined | null): string | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const [rule, amount] = text.includes(':') ? text.split(':', 2) : ['auto', text];
  const number = Number.parseFloat(amount);
  if (!Number.isFinite(number) || number <= 0) return null;
  return rule === 'auto' ? `${(number * WORD_LINE_FACTOR).toFixed(3)}` : `${number}pt`;
}

function pt(value: unknown): string | null {
  const number = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(number) ? `${number}pt` : null;
}

function applyWordProps(dom: HTMLElement, content: HTMLElement | undefined, props: Record<string, any>) {
  const before = pt(props.spaceBefore);
  const after = pt(props.spaceAfter);
  const line = cssLineHeight(props.lineSpacing);
  const left = pt(props.indentLeft);
  const right = pt(props.indentRight);
  const first = pt(props.indentFirst);
  if (before) dom.style.marginTop = before;
  if (after) dom.style.marginBottom = after;
  if (line) dom.style.lineHeight = line;
  if (left) dom.style.paddingLeft = left;
  if (right) dom.style.paddingRight = right;
  if (first && content) content.style.textIndent = first;
  if (props.wordStyle) dom.dataset.wordStyle = props.wordStyle;
}

const WORD_PROP_NAMES = Object.keys(WORD_BLOCK_PROPS);

/** The block as the original spec knows it (its DOM wrapper looks up every prop it gets). */
function withoutWordProps(block: any) {
  if (!block?.props) return block;
  const props = { ...block.props };
  WORD_PROP_NAMES.forEach((name) => delete props[name]);
  return { ...block, props };
}

/** A default block spec that also carries (and shows) Word paragraph formatting. */
export function withWordProps<T>(spec: T): T {
  const source = spec as any;
  const render = source.implementation.render;
  const toExternalHTML = source.implementation.toExternalHTML;
  return {
    ...source,
    config: { ...source.config, propSchema: { ...source.config.propSchema, ...WORD_BLOCK_PROPS } },
    implementation: {
      ...source.implementation,
      render(this: unknown, block: any, editor: any) {
        const view = render.call(this, withoutWordProps(block), editor);
        try {
          applyWordProps(view.dom as HTMLElement, view.contentDOM as HTMLElement | undefined, block.props || {});
        } catch {
          /* formatting is best effort; content still renders */
        }
        return view;
      },
      ...(toExternalHTML
        ? {
          toExternalHTML(this: unknown, block: any, editor: any, context: any) {
            const output = toExternalHTML.call(this, withoutWordProps(block), editor, context);
            try {
              if (output?.dom) applyWordProps(output.dom as HTMLElement, output.contentDOM as HTMLElement | undefined, block.props || {});
            } catch {
              /* copy/paste keeps the text either way */
            }
            return output;
          },
        }
        : {}),
    },
  } as T;
}

// ---------------------------------------------------------------- tracked changes

function suggestionRender(kind: 'insert' | 'delete') {
  return (value?: string) => {
    const [id, author, date] = String(value || '').split('|');
    const element = document.createElement(kind === 'insert' ? 'ins' : 'del');
    element.className = kind === 'insert' ? 'ce-suggest-insert' : 'ce-suggest-delete';
    element.dataset.suggestion = value || '';
    element.dataset.suggestionId = id || '';
    const when = date ? new Date(date) : null;
    element.title = `${kind === 'insert' ? 'Added' : 'Deleted'} by ${author || 'someone'}${when && !Number.isNaN(when.getTime()) ? ` · ${when.toLocaleString()}` : ''}`;
    return { dom: element, contentDOM: element };
  };
}

export const suggestionInsertStyleSpec = createStyleSpec(
  { type: 'suggestionInsert', propSchema: 'string' },
  {
    render: suggestionRender('insert'),
    toExternalHTML: suggestionRender('insert'),
    parse: (element: HTMLElement) => (element.tagName === 'INS' && element.dataset.suggestion ? element.dataset.suggestion : undefined),
  } as any,
);

export const suggestionDeleteStyleSpec = createStyleSpec(
  { type: 'suggestionDelete', propSchema: 'string' },
  {
    render: suggestionRender('delete'),
    toExternalHTML: suggestionRender('delete'),
    parse: (element: HTMLElement) => (element.tagName === 'DEL' && element.dataset.suggestion ? element.dataset.suggestion : undefined),
  } as any,
);

// ---------------------------------------------------------------- footnotes

function FootnoteMarker({ text, kind, onChange, isEditable }: { text: string; kind: string; onChange: (next: string) => void; isEditable: () => boolean }) {
  const [open, setOpen] = useState(false);
  // Read when the note opens: the editor becomes editable after its content has rendered.
  const editable = open && isEditable();
  const [draft, setDraft] = useState(text);
  const anchor = useRef<HTMLSpanElement | null>(null);
  useEffect(() => setDraft(text), [text]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      if (anchor.current && !anchor.current.contains(event.target as Node)) {
        setOpen(false);
        if (draft !== text) onChange(draft);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [draft, onChange, open, text]);
  return (
    <span ref={anchor} className="ce-footnote-wrap" contentEditable={false}>
      <sup
        className={`ce-footnote ${kind === 'endnote' ? 'ce-endnote' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={`${kind === 'endnote' ? 'Endnote' : 'Footnote'}: ${text || 'empty'}`}
        title={text}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      />
      {open ? (
        <span className="ce-footnote-popover" role="dialog" aria-label="Footnote text" onMouseDown={(event) => event.stopPropagation()}>
          <span className="ce-footnote-popover-title">{kind === 'endnote' ? 'Endnote' : 'Footnote'}</span>
          {editable ? (
            <textarea
              autoFocus
              value={draft}
              rows={3}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape') {
                  setOpen(false);
                  if (draft !== text) onChange(draft);
                }
              }}
              placeholder="Footnote text"
            />
          ) : (
            <span className="ce-footnote-popover-text">{text}</span>
          )}
        </span>
      ) : null}
    </span>
  );
}

export const footnoteInlineContentSpec = createReactInlineContentSpec(
  {
    type: 'footnote',
    content: 'none',
    propSchema: {
      text: { default: '' },
      kind: { default: 'footnote' },
    },
  },
  {
    parse: (element) => (element.dataset.inlineContentType === 'footnote'
      ? { text: element.getAttribute('data-text') ?? '', kind: element.getAttribute('data-kind') ?? 'footnote' }
      : undefined),
    render: ({ inlineContent, updateInlineContent, editor }) => (
      <span data-inline-content-type="footnote" data-text={inlineContent.props.text} data-kind={inlineContent.props.kind}>
        <FootnoteMarker
          text={inlineContent.props.text}
          kind={inlineContent.props.kind}
          isEditable={() => editor.isEditable}
          onChange={(next) => updateInlineContent({ ...inlineContent, props: { ...inlineContent.props, text: next } } as any)}
        />
      </span>
    ),
  },
);

/** Footnotes in reading order (for the notes area under the page). */
export function collectFootnotes(blocks: any[]): { text: string; kind: string }[] {
  const notes: { text: string; kind: string }[] = [];
  const walkInline = (items: any) => {
    if (!Array.isArray(items)) return;
    items.forEach((item) => {
      if (item?.type === 'footnote') notes.push({ text: item.props?.text || '', kind: item.props?.kind || 'footnote' });
      if (item?.type === 'link') walkInline(item.content);
    });
  };
  const walk = (list: any[]) => list.forEach((block) => {
    if (Array.isArray(block.content)) walkInline(block.content);
    if (block.content?.type === 'tableContent') {
      block.content.rows?.forEach((row: any) => row.cells?.forEach((cell: any) => walkInline(cell.content ?? cell)));
    }
    if (block.children?.length) walk(block.children);
  });
  walk(blocks);
  return notes;
}

// ---------------------------------------------------------------- table of contents

function TableOfContents({ editor }: { editor: any }) {
  const [entries, setEntries] = useState<{ id: string; level: number; text: string }[]>([]);
  const read = () => {
    const next: { id: string; level: number; text: string }[] = [];
    const walk = (blocks: any[]) => blocks.forEach((block) => {
      if (block.type === 'heading' && Number(block.props?.level) <= 3) {
        const text = (Array.isArray(block.content) ? block.content : [])
          .map((item: any) => (item.type === 'text' ? item.text : item.type === 'link' ? item.content?.map((c: any) => c.text).join('') : ''))
          .join('')
          .trim();
        if (text) next.push({ id: block.id, level: Number(block.props.level) || 1, text });
      }
      if (block.children?.length) walk(block.children);
    });
    walk(editor.document);
    setEntries((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  };
  useEffect(read, [editor]);
  useEditorChange(read, editor);
  return (
    <nav className="ce-toc" contentEditable={false} aria-label="Table of contents">
      <div className="ce-toc-title">Contents</div>
      {entries.length ? entries.map((entry) => (
        <a
          key={entry.id}
          href={`#${entry.id}`}
          className={`ce-toc-entry ce-toc-level-${entry.level}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            document.querySelector(`[data-id="${entry.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          {entry.text}
        </a>
      )) : <div className="ce-toc-empty">Headings you add appear here.</div>}
    </nav>
  );
}

export const tableOfContentsBlockSpec = createReactBlockSpec(
  { type: 'tableOfContents', propSchema: {}, content: 'none' },
  { render: ({ editor }) => <TableOfContents editor={editor} /> },
);

// ---------------------------------------------------------------- document styles

export type WordSettings = {
  version?: number;
  page?: { widthPt?: string; heightPt?: string; orientation?: string; columns?: number; margins?: Record<string, string> };
  header?: Record<string, { text: string; align?: string }>;
  footer?: Record<string, { text: string; align?: string }>;
  differentFirstPage?: boolean;
  pageNumberStart?: number;
  styles?: {
    normal?: Record<string, any>;
    headings?: Record<string, Record<string, any>>;
  };
  sections?: any[];
  source?: { fileName?: string; importedAt?: string };
};

const quoteFont = (font: string) => (/[\s,]/.test(font) && !font.includes(',') ? `"${font}"` : font);

/** CSS that makes the editor look like the Word file: base font, spacing and heading styles. */
export function wordSettingsCss(settings: WordSettings | null | undefined, scope = '.ai-editor-blocknote'): string {
  const styles = settings?.styles;
  if (!styles) return '';
  const rules: string[] = [];
  const normal = styles.normal || {};
  const base: string[] = [];
  if (normal.fontFamily) base.push(`font-family: ${quoteFont(normal.fontFamily)}, "Times New Roman", serif;`);
  if (normal.fontSize) base.push(`font-size: ${normal.fontSize}pt;`);
  const line = cssLineHeight(normal.lineSpacing);
  if (line) base.push(`line-height: ${line};`);
  if (base.length) rules.push(`${scope} { ${base.join(' ')} }`);
  // Headers, footers and notes are drawn outside the editor on page 1, so they need the font too.
  if (normal.fontFamily) rules.push(`.ce-page-header, .ce-page-footer, .ce-page-notes { font-family: ${quoteFont(normal.fontFamily)}, "Times New Roman", serif; }`);
  const blockSpacing: string[] = [];
  if (normal.spaceBefore) blockSpacing.push(`margin-top: ${normal.spaceBefore}pt;`);
  if (normal.spaceAfter) blockSpacing.push(`margin-bottom: ${normal.spaceAfter}pt;`);
  if (blockSpacing.length) {
    rules.push(`${scope} .bn-block-content[data-content-type="paragraph"], ${scope} .bn-block-content[data-content-type$="ListItem"] { ${blockSpacing.join(' ')} }`);
    rules.push(`${scope} .bn-block-outer { margin-top: 0; margin-bottom: 0; }`);
  }
  Object.entries(styles.headings || {}).forEach(([level, info]) => {
    if (!/^\d$/.test(level)) return;
    const parts: string[] = [];
    if (info.fontFamily) parts.push(`font-family: ${quoteFont(info.fontFamily)}, sans-serif !important;`);
    if (info.fontSize) parts.push(`--level: ${info.fontSize}pt; font-size: ${info.fontSize}pt;`);
    if (info.color) parts.push(`color: ${info.color};`);
    parts.push(`font-weight: ${info.bold === false ? 400 : 700};`);
    if (info.italic) parts.push('font-style: italic;');
    if (info.spaceBefore) parts.push(`margin-top: ${info.spaceBefore}pt;`);
    if (info.spaceAfter !== undefined) parts.push(`margin-bottom: ${info.spaceAfter}pt;`);
    rules.push(`${scope} .bn-block-content[data-content-type="heading"][data-level="${level}"] { ${parts.join(' ')} }`);
  });
  const title = styles.headings?.title;
  if (title) {
    const parts: string[] = [];
    if (title.fontFamily) parts.push(`font-family: ${quoteFont(title.fontFamily)}, sans-serif !important;`);
    if (title.fontSize) parts.push(`--level: ${title.fontSize}pt; font-size: ${title.fontSize}pt;`);
    if (title.color) parts.push(`color: ${title.color};`);
    parts.push(`font-weight: ${title.bold ? 700 : 400};`);
    rules.push(`${scope} .bn-block-content[data-content-type="heading"][data-word-style="Title"] { ${parts.join(' ')} }`);
  }
  return rules.join('\n');
}

/** Page geometry in CSS pixels at 100% zoom (96 dpi). */
export function pageGeometry(settings: WordSettings | null | undefined) {
  const page = settings?.page;
  const toPx = (value: unknown, fallback: number) => {
    const number = Number.parseFloat(String(value ?? ''));
    return Math.round((Number.isFinite(number) ? number : fallback) * (96 / 72));
  };
  const margins = page?.margins || {};
  return {
    width: toPx(page?.widthPt, 595.3),
    height: toPx(page?.heightPt, 841.9),
    top: toPx(margins.top, 72),
    right: toPx(margins.right, 72),
    bottom: toPx(margins.bottom, 72),
    left: toPx(margins.left, 72),
    header: toPx(margins.header, 36),
    footer: toPx(margins.footer, 36),
  };
}

export const WORD_EDITOR_CSS = `
  .ai-editor-blocknote .bn-editor { counter-reset: ce-footnote; }
  .ce-footnote-wrap { position: relative; display: inline; }
  .ce-footnote { counter-increment: ce-footnote; cursor: pointer; color: var(--theme-primary-dark, #1a56db); font-size: 0.7em; padding: 0 1px; }
  .ce-footnote::after { content: counter(ce-footnote); }
  .ce-footnote:hover { text-decoration: underline; }
  .ce-footnote-popover { position: absolute; z-index: 60; top: 1.6em; left: -8px; width: 280px; display: flex; flex-direction: column; gap: 6px;
    background: #fff; border: 1px solid #dadce0; border-radius: 10px; box-shadow: 0 6px 24px rgba(60,64,67,.18); padding: 10px;
    font-family: system-ui, sans-serif; font-size: 13px; line-height: 1.4; text-indent: 0; color: #1f1f1f; font-weight: 400; font-style: normal; }
  .ce-footnote-popover-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: #5f6368; }
  .ce-footnote-popover textarea { width: 100%; resize: vertical; border: 1px solid #dadce0; border-radius: 6px; padding: 6px 8px; font: inherit; outline: none; }
  .ce-footnote-popover textarea:focus { border-color: #0b57d0; }
  ins.ce-suggest-insert { text-decoration: none; color: #137333; background: rgba(19,115,51,.08); border-bottom: 2px solid rgba(19,115,51,.55); }
  del.ce-suggest-delete { color: #a50e0e; text-decoration: line-through; text-decoration-color: rgba(165,14,14,.7); background: rgba(165,14,14,.06); }
  .ce-toc { display: block; padding: 6px 0 10px; font-family: inherit; }
  .ce-toc-title { font-weight: 700; font-size: 1.15em; margin-bottom: 6px; }
  .ce-toc-entry { display: block; color: inherit; text-decoration: none; padding: 1px 0; cursor: pointer; }
  .ce-toc-entry:hover { color: var(--theme-primary-dark, #1a56db); text-decoration: underline; }
  .ce-toc-level-2 { padding-left: 1.5em; }
  .ce-toc-level-3 { padding-left: 3em; }
  .ce-toc-empty { color: #80868b; font-style: italic; }
`;
