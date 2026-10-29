'use client';

import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/**
 * Page view for the editor (as in Word and Google Docs' print layout): the continuous text
 * is cut into pages by "page gap" widgets showing the bottom of one page (footnotes, footer,
 * page number), the space between sheets and the top of the next page (header).
 *
 * Layout is measured from the DOM with the gaps hidden, then gaps are placed between blocks,
 * or inside a paragraph at the first line that no longer fits, so long paragraphs flow across
 * pages like in Word. Headings keep with the text after them; tables and images move whole.
 */

export type PaginationConfig = {
  enabled: boolean;
  pageHeight: number; // px at 100% zoom
  pageWidth: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  headerOffset: number; // distance of the header from the page top
  footerOffset: number;
  gap: number;
  headerFor: (page: number) => string;
  footerFor: (page: number) => string;
};

type PageBreak = {
  pos: number;
  inline: boolean;
  leftover: number; // unused space at the bottom of the page that ends here
  page: number; // page that ends here (1-based)
  notes: { number: number; text: string }[];
  indent: number; // px from the page's content box left to the widget's left
};

type State = { decorations: DecorationSet; breaks: PageBreak[]; pages: number; finalLeftover: number; finalNotes: { number: number; text: string }[] };

export const paginationKey = new PluginKey<State>('ce-pagination');
const NOTE_LINE_PX = 16;

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] as string));
}

function gapElement(config: PaginationConfig, brk: { leftover: number; page: number; notes: { number: number; text: string }[]; indent: number }, final: boolean) {
  const wrapper = document.createElement(final ? 'div' : 'span');
  wrapper.className = `ce-page-gap${final ? ' ce-page-gap-final' : ''}`;
  wrapper.contentEditable = 'false';
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.dataset.page = String(brk.page);
  const bottomHeight = Math.max(0, brk.leftover) + config.marginBottom;
  const notes = brk.notes.length
    ? `<span class="ce-page-notes" style="bottom:${config.marginBottom - 6}px;left:${config.marginLeft}px;right:${config.marginRight}px">${brk.notes
      .map((note) => `<span class="ce-page-note"><sup>${note.number}</sup> ${escapeHtml(note.text)}</span>`).join('')}</span>`
    : '';
  const footer = config.footerFor(brk.page);
  const header = final ? '' : config.headerFor(brk.page + 1);
  wrapper.innerHTML = `
    <span class="ce-page-bottom" style="height:${bottomHeight}px">${notes}${footer
      ? `<span class="ce-page-footer" style="bottom:${config.footerOffset}px;left:${config.marginLeft}px;right:${config.marginRight}px">${footer}</span>` : ''}</span>
    ${final ? '' : `<span class="ce-page-separator" style="height:${config.gap}px"></span>
    <span class="ce-page-top" style="height:${config.marginTop}px">${header
      ? `<span class="ce-page-header" style="top:${config.headerOffset}px;left:${config.marginLeft}px;right:${config.marginRight}px">${header}</span>` : ''}</span>`}`;
  wrapper.style.width = `${config.pageWidth}px`;
  wrapper.style.marginLeft = `${-(config.marginLeft + brk.indent)}px`;
  return wrapper;
}

function buildDecorations(state: EditorState, breaks: PageBreak[], config: PaginationConfig, finalLeftover: number, finalNotes: { number: number; text: string }[], pages: number) {
  const decorations: Decoration[] = [];
  breaks.forEach((brk) => {
    if (brk.pos < 0 || brk.pos > state.doc.content.size) return;
    decorations.push(Decoration.widget(brk.pos, () => gapElement(config, brk, false), {
      side: -1,
      key: `gap-${brk.page}-${brk.pos}-${brk.leftover.toFixed(0)}-${brk.notes.length}-${brk.inline ? 'i' : 'b'}`,
      ignoreSelection: true,
    }));
  });
  decorations.push(Decoration.widget(state.doc.content.size, () => gapElement(config, { leftover: finalLeftover, page: pages, notes: finalNotes, indent: 0 }, true), {
    side: 1,
    key: `gap-final-${pages}-${finalLeftover.toFixed(0)}-${finalNotes.length}`,
    ignoreSelection: true,
  }));
  return DecorationSet.create(state.doc, decorations);
}

type Unit = {
  outer: HTMLElement;
  content: HTMLElement;
  top: number;
  bottom: number;
  type: string;
  notes: { number: number; text: string }[];
};

/** Measures the document with the gaps hidden and works out where pages end. */
function measure(view: EditorView, config: PaginationConfig) {
  const root = view.dom as HTMLElement;
  root.classList.add('ce-paginating');
  try {
    const rootRect = root.getBoundingClientRect();
    const scale = root.offsetWidth ? rootRect.width / root.offsetWidth : 1;
    const y = (value: number) => (value - rootRect.top) / scale;
    const contentLeft = rootRect.left;
    const outers = Array.from(root.querySelectorAll<HTMLElement>('.bn-block-outer'));
    let noteNumber = 0;
    const units: Unit[] = [];
    outers.forEach((outer) => {
      const content = outer.querySelector<HTMLElement>(':scope > .bn-block > .bn-block-content');
      if (!content) return;
      const rect = content.getBoundingClientRect();
      const style = window.getComputedStyle(content);
      const notes = Array.from(content.querySelectorAll<HTMLElement>('[data-inline-content-type="footnote"]')).map((node) => {
        noteNumber += 1;
        return { number: noteNumber, text: node.getAttribute('data-text') || '' };
      });
      units.push({
        outer,
        content,
        top: y(rect.top) - Number.parseFloat(style.marginTop || '0'),
        bottom: y(rect.bottom) + Number.parseFloat(style.marginBottom || '0'),
        type: content.dataset.contentType || '',
        notes,
      });
    });

    const pageArea = config.pageHeight - config.marginTop - config.marginBottom;
    const breaks: PageBreak[] = [];
    let pageStart = 0;
    let page = 1;
    let pageNotes: { number: number; text: string }[] = [];
    let notesHeight = 0;
    const noteHeight = (text: string) => Math.max(1, Math.ceil((text.length * 6.2) / Math.max(200, config.pageWidth - config.marginLeft - config.marginRight))) * NOTE_LINE_PX;
    const available = () => pageArea - (notesHeight ? notesHeight + 12 : 0);
    const blockPositions = new Map<string, number>();
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'blockContainer' && node.attrs.id) blockPositions.set(node.attrs.id, pos);
      return true;
    });
    const positionBefore = (unit: Unit) => blockPositions.get(unit.outer.dataset.id || '') ?? -1;
    const indentOf = (element: Element) => (element.getBoundingClientRect().left - contentLeft) / scale;
    const endPage = (pos: number, breakTop: number, inline: boolean, indent: number) => {
      breaks.push({ pos, inline, leftover: pageStart + available() - breakTop, page, notes: pageNotes, indent });
      page += 1;
      pageStart = breakTop;
      pageNotes = [];
      notesHeight = 0;
    };

    const lineRects = (unit: Unit) => {
      const inline = unit.content.querySelector<HTMLElement>('.bn-inline-content') || unit.content;
      const range = document.createRange();
      range.selectNodeContents(inline);
      const lines: { top: number; bottom: number; clientTop: number; clientLeft: number }[] = [];
      Array.from(range.getClientRects()).forEach((rect) => {
        if (rect.height < 2 || rect.width < 0.5) return;
        const top = y(rect.top);
        const last = lines[lines.length - 1];
        if (!last || top >= last.bottom - 2) {
          lines.push({ top, bottom: y(rect.bottom), clientTop: rect.top, clientLeft: rect.left });
        } else {
          last.bottom = Math.max(last.bottom, y(rect.bottom));
          last.clientLeft = Math.min(last.clientLeft, rect.left);
        }
      });
      return lines;
    };
    const isCaption = (unit: Unit | undefined, pattern: RegExp) => {
      const text = (unit?.content.textContent || '').trim();
      return unit?.type === 'paragraph' && text.length < 300 && pattern.test(text);
    };
    const keepTogetherAnchor = (index: number) => {
      // Word's "keep with next": a heading stays with the block after it, a table caption
      // with its table, and a figure with the caption under it.
      const previous = units[index - 1];
      const current = units[index];
      if (!previous || previous.top <= pageStart + 1) return current;
      if (previous.type === 'heading') return previous;
      if (current.type === 'table' && isCaption(previous, /^(table|tab\.)\s*[\dIVXLC]/i)) return previous;
      if (previous.type === 'image' && isCaption(current, /^(figure|fig\.)\s*\d/i)) return previous;
      return current;
    };
    const moveToNextPage = (index: number) => {
      const anchor = keepTogetherAnchor(index);
      if (anchor !== units[index] && anchor.notes.length) {
        pageNotes = pageNotes.slice(0, Math.max(0, pageNotes.length - anchor.notes.length));
      }
      endPage(positionBefore(anchor), anchor.top, false, indentOf(anchor.outer));
      if (anchor !== units[index]) pageNotes = [...pageNotes, ...anchor.notes];
    };

    for (let index = 0; index < units.length; index += 1) {
      const unit = units[index];
      if (unit.type === 'pageBreak') {
        const next = units[index + 1];
        if (next) endPage(positionBefore(next), next.top, false, indentOf(next.outer));
        continue;
      }
      // Footnotes of this block need room at the bottom of the same page.
      const extraNotes = unit.notes.reduce((sum, note) => sum + noteHeight(note.text), 0);
      const room = () => available() - extraNotes - (extraNotes && !notesHeight ? 12 : 0);
      if (unit.bottom - pageStart <= room()) {
        pageNotes = [...pageNotes, ...unit.notes];
        notesHeight += extraNotes;
        continue;
      }
      const splittable = ['paragraph', 'bulletListItem', 'numberedListItem', 'checkListItem', 'quote'].includes(unit.type);
      if (!splittable) {
        if (unit.top > pageStart + 1) moveToNextPage(index);
        pageNotes = [...pageNotes, ...unit.notes];
        notesHeight += extraNotes;
        continue; // taller than a page: it overflows its page, as a big table does in Word
      }
      const lines = lineRects(unit);
      let line = 0;
      let guard = 0;
      while (line < lines.length && guard < 400) {
        guard += 1;
        let fit = 0;
        while (line + fit < lines.length && lines[line + fit].bottom - pageStart <= room()) fit += 1;
        if (line + fit >= lines.length) break;
        const atPageTop = lines[line].top <= pageStart + 1 || (line === 0 && unit.top <= pageStart + 1);
        // Keep at least two lines together at the bottom of a page (orphan control).
        if (line === 0 && fit < 2 && lines.length > 1 && !atPageTop) {
          moveToNextPage(index);
          continue;
        }
        if (fit === 0) fit = 1; // a single line taller than the page area
        const target = lines[line + fit];
        if (!target) break; // that was the paragraph's last line
        const coords = view.posAtCoords({ left: target.clientLeft + 1, top: target.clientTop + 2 });
        if (!coords) break;
        endPage(coords.pos, target.top, true, indentOf(unit.content));
        line += fit;
      }
      pageNotes = [...pageNotes, ...unit.notes];
      notesHeight += extraNotes;
    }
    const contentBottom = units.length ? units[units.length - 1].bottom : 0;
    const finalLeftover = Math.max(0, pageStart + available() - contentBottom);
    return { breaks: breaks.filter((brk) => brk.pos >= 0), pages: page, finalLeftover, finalNotes: pageNotes };
  } finally {
    root.classList.remove('ce-paginating');
  }
}

/**
 * The plugin. `getConfig` is read on every layout; call `requestLayout(view)` when the page
 * setup changes. `onPages` receives the page count.
 */
export function createPaginationPlugin(getConfig: () => PaginationConfig | null, onPages: (pages: number) => void) {
  let timer: number | null = null;
  let frame: number | null = null;
  let lastSignature = '';

  const run = (view: EditorView) => {
    const config = getConfig();
    if (!config || !config.enabled || !view.dom.isConnected) {
      const current = paginationKey.getState(view.state);
      if (current && current.breaks.length + 1 > 0 && current.decorations !== DecorationSet.empty) {
        view.dispatch(view.state.tr.setMeta(paginationKey, { breaks: [], pages: 1, finalLeftover: 0, finalNotes: [], clear: true }).setMeta('addToHistory', false));
      }
      onPages(1);
      return;
    }
    const result = measure(view, config);
    const signature = JSON.stringify([result.breaks.map((b) => [b.pos, Math.round(b.leftover), b.notes.length, Math.round(b.indent)]), Math.round(result.finalLeftover), result.finalNotes.length, config.headerFor(2), config.footerFor(1), config.pageHeight, config.pageWidth]);
    onPages(result.pages);
    if (signature === lastSignature) return;
    lastSignature = signature;
    view.dispatch(view.state.tr.setMeta(paginationKey, result).setMeta('addToHistory', false));
  };

  const schedule = (view: EditorView, delay = 160) => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => run(view));
    }, delay);
  };

  return new Plugin<State>({
    key: paginationKey,
    state: {
      init: () => ({ decorations: DecorationSet.empty, breaks: [], pages: 1, finalLeftover: 0, finalNotes: [] }),
      apply(tr, value, _old, newState) {
        const meta = tr.getMeta(paginationKey);
        if (meta) {
          const config = getConfig();
          if (meta.clear || !config || !config.enabled) {
            return { decorations: DecorationSet.empty, breaks: [], pages: 1, finalLeftover: 0, finalNotes: [] };
          }
          return { ...meta, decorations: buildDecorations(newState, meta.breaks, config, meta.finalLeftover, meta.finalNotes, meta.pages) };
        }
        if (!tr.docChanged) return value;
        return { ...value, decorations: value.decorations.map(tr.mapping, tr.doc) };
      },
    },
    props: {
      decorations(state) {
        return paginationKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
    view(view) {
      const resize = new ResizeObserver(() => schedule(view, 60));
      resize.observe(view.dom);
      const onRequest = () => {
        lastSignature = '';
        schedule(view, 0);
      };
      view.dom.addEventListener('ce-pagination-refresh', onRequest);
      void (document as any).fonts?.ready?.then(() => schedule(view, 0));
      schedule(view, 50);
      return {
        update(updated, previous) {
          if (updated.state.doc !== previous.doc) schedule(updated);
        },
        destroy() {
          resize.disconnect();
          view.dom.removeEventListener('ce-pagination-refresh', onRequest);
          if (timer) window.clearTimeout(timer);
          if (frame) window.cancelAnimationFrame(frame);
        },
      };
    },
  });
}

/** Re-lays out the pages now (after the page setup or zoom changes). */
export function requestLayout(root: HTMLElement | null | undefined) {
  root?.dispatchEvent(new Event('ce-pagination-refresh'));
}

export const PAGINATION_CSS = `
  .ce-paginating .ce-page-gap { display: none !important; }
  .ce-page-gap { display: block; position: relative; user-select: none; pointer-events: none; text-indent: 0; line-height: 1.3;
    font-family: inherit; font-size: 10pt; font-weight: 400; font-style: normal; color: #5f6368; text-align: left; white-space: normal; }
  .ce-page-gap > span { display: block; position: relative; }
  .ce-page-bottom { background: #fff; }
  .ce-page-top { background: #fff; }
  .ce-page-separator { background: var(--ce-canvas, #f0f2f5); margin: 0 -2px; box-shadow: inset 0 6px 6px -6px rgba(60,64,67,.35), inset 0 -6px 6px -6px rgba(60,64,67,.35); }
  .ce-page-header, .ce-page-footer { position: absolute; display: block; white-space: pre-wrap; font-size: 10pt; color: #3c4043; }
  .ce-page-footer { text-align: center; }
  .ce-page-notes { position: absolute; display: block; border-top: 1px solid #9aa0a6; padding-top: 4px; max-width: 45%; min-width: 120px; }
  .ce-page-notes { max-width: none; }
  .ce-page-note { display: block; font-size: 9.5pt; color: #202124; line-height: 1.35; }
  .ce-page-note sup { font-size: 0.75em; }
  .ce-page-gap-final { margin-top: 0; }
  .ai-editor-paginated .bn-block-content[data-content-type="pageBreak"] > div { visibility: hidden; height: 1px !important; margin: 0 !important; }
`;
