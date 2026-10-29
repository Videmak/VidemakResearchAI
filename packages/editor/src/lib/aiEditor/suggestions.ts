'use client';

import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Mark, MarkType, Node as PMNode } from '@tiptap/pm/model';

/**
 * Suggested edits (Word's tracked changes, Docs' "Suggesting"): added text carries the
 * `suggestionInsert` style and removed text stays visible with `suggestionDelete`, both with
 * "id|author|date". Accepting keeps the added text and drops the removed text; rejecting does
 * the opposite. Word files bring their tracked changes in this form and get them back on export.
 */

export const AI_AUTHOR = 'Videmak AI';

export type Suggestion = {
  id: string;
  kind: 'insert' | 'delete' | 'replace';
  author: string;
  date: string;
  inserted: string;
  deleted: string;
  from: number;
  to: number;
};

export function newSuggestionValue(author: string) {
  const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${id}|${author.replace(/\|/g, ' ')}|${new Date().toISOString()}`;
}

const parse = (value: string) => {
  const [id, author, date] = String(value || '').split('|');
  return { id: id || '', author: author || '', date: date || '' };
};

function markTypes(state: EditorState) {
  return {
    insert: state.schema.marks.suggestionInsert as MarkType | undefined,
    remove: state.schema.marks.suggestionDelete as MarkType | undefined,
  };
}

function suggestionMark(node: PMNode, type: MarkType | undefined): Mark | undefined {
  return type ? node.marks.find((mark) => mark.type === type) : undefined;
}

/** Every suggestion in the document, in reading order (a replacement is one entry). */
export function collectSuggestions(state: EditorState): Suggestion[] {
  const { insert, remove } = markTypes(state);
  const byId = new Map<string, Suggestion>();
  state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    for (const [type, kind] of [[insert, 'insert'], [remove, 'delete']] as const) {
      const mark = suggestionMark(node, type);
      if (!mark) continue;
      const meta = parse(mark.attrs.stringValue);
      const key = meta.id;
      const existing = byId.get(key);
      if (existing) {
        existing.from = Math.min(existing.from, pos);
        existing.to = Math.max(existing.to, pos + node.nodeSize);
        if (kind === 'insert') existing.inserted += node.text || '';
        else existing.deleted += node.text || '';
        if (existing.kind !== kind) existing.kind = 'replace';
      } else {
        byId.set(key, {
          id: key, kind, author: meta.author, date: meta.date,
          inserted: kind === 'insert' ? node.text || '' : '',
          deleted: kind === 'delete' ? node.text || '' : '',
          from: pos, to: pos + node.nodeSize,
        });
      }
    }
    return true;
  });
  return Array.from(byId.values()).sort((a, b) => a.from - b.from);
}

/** Accepts or rejects suggestions (all of them when `ids` is null). */
export function resolveSuggestions(view: EditorView, ids: string[] | null, accept: boolean) {
  const { state } = view;
  const { insert, remove } = markTypes(state);
  if (!insert || !remove) return 0;
  const wanted = ids ? new Set(ids) : null;
  const ranges: { from: number; to: number; kind: 'insert' | 'delete'; mark: Mark }[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const ins = suggestionMark(node, insert);
    const del = suggestionMark(node, remove);
    if (ins && (!wanted || wanted.has(parse(ins.attrs.stringValue).id))) ranges.push({ from: pos, to: pos + node.nodeSize, kind: 'insert', mark: ins });
    if (del && (!wanted || wanted.has(parse(del.attrs.stringValue).id))) ranges.push({ from: pos, to: pos + node.nodeSize, kind: 'delete', mark: del });
    return true;
  });
  if (!ranges.length) return 0;
  const tr = state.tr;
  // Work from the end so earlier positions stay valid.
  ranges.sort((a, b) => b.from - a.from).forEach((range) => {
    const removeText = (accept && range.kind === 'delete') || (!accept && range.kind === 'insert');
    if (removeText) tr.delete(range.from, range.to);
    else tr.removeMark(range.from, range.to, range.mark);
  });
  tr.setMeta(suggestionKey, { internal: true });
  view.dispatch(tr);
  return new Set(ranges.map((range) => parse(range.mark.attrs.stringValue).id)).size;
}

/**
 * Replaces from..to with `text` as one suggestion (the old text is marked removed, the new
 * text added after it). Used for AI edits and review fixes.
 */
export function replaceAsSuggestion(view: EditorView, from: number, to: number, text: string, author: string) {
  const { state } = view;
  const { insert, remove } = markTypes(state);
  if (!insert || !remove) return false;
  const value = newSuggestionValue(author);
  const tr = state.tr;
  if (to > from) tr.addMark(from, to, remove.create({ stringValue: value }));
  if (text) {
    const marks = (state.doc.resolve(Math.max(from, Math.min(to, state.doc.content.size))).marks() || [])
      .filter((mark) => mark.type !== insert && mark.type !== remove);
    tr.insert(to, state.schema.text(text, [...marks, insert.create({ stringValue: value })]));
  }
  tr.setMeta(suggestionKey, { internal: true });
  view.dispatch(tr);
  return true;
}

/** The position range of `text` inside the block with `blockId` (first match). */
export function findTextInBlock(state: EditorState, blockId: string | null, text: string): { from: number; to: number } | null {
  if (!text) return null;
  let found: { from: number; to: number } | null = null;
  state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'blockContainer' && blockId && node.attrs.id !== blockId) return true;
    if (node.isTextblock) {
      let offset = 0;
      const chars: number[] = [];
      let joined = '';
      node.forEach((child, childOffset) => {
        if (child.isText) {
          for (let index = 0; index < (child.text || '').length; index += 1) chars.push(pos + 1 + childOffset + index);
          joined += child.text || '';
        } else {
          chars.push(pos + 1 + childOffset);
          joined += '￼';
        }
        offset += child.nodeSize;
      });
      const index = joined.indexOf(text);
      if (index >= 0) {
        found = { from: chars[index], to: chars[index + text.length - 1] + 1 };
        return false;
      }
      return false;
    }
    return true;
  });
  return found;
}

// ---------------------------------------------------------------- suggesting mode

export const suggestionKey = new PluginKey('ce-suggesting');

type ModeConfig = { enabled: boolean; author: string };

function markedValue(state: EditorState, pos: number, type: MarkType | undefined): string | null {
  if (!type) return null;
  const $pos = state.doc.resolve(pos);
  const node = $pos.parent.childAfter($pos.parentOffset).node;
  const mark = node?.marks.find((item) => item.type === type);
  return mark ? mark.attrs.stringValue : null;
}

/** In Suggesting mode, typing and deleting become suggestions in the writer's name. */
export function createSuggestingPlugin(getConfig: () => ModeConfig) {
  let sessionValue: { value: string; author: string } | null = null;
  const valueFor = (author: string) => {
    if (!sessionValue || sessionValue.author !== author) sessionValue = { value: newSuggestionValue(author), author };
    return sessionValue.value;
  };

  const markRemoved = (state: EditorState, tr: Transaction, from: number, to: number, author: string) => {
    const { insert, remove } = markTypes(state);
    if (!insert || !remove) return;
    // Text this writer just suggested adding is simply removed; anything else is marked removed.
    const pieces: { from: number; to: number; own: boolean }[] = [];
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return true;
      const start = Math.max(from, pos);
      const end = Math.min(to, pos + node.nodeSize);
      const ins = suggestionMark(node, insert);
      pieces.push({ from: start, to: end, own: Boolean(ins && parse(ins.attrs.stringValue).author === author) });
      return true;
    });
    pieces.sort((a, b) => b.from - a.from).forEach((piece) => {
      if (piece.own) tr.delete(piece.from, piece.to);
      else tr.addMark(piece.from, piece.to, remove.create({ stringValue: valueFor(author) }));
    });
  };

  return new Plugin({
    key: suggestionKey,
    props: {
      handleTextInput(view, from, to, text) {
        const config = getConfig();
        const { insert, remove } = markTypes(view.state);
        if (!config.enabled || !insert || !remove) return false;
        // "/" and "@" at the start of a paragraph or after a space open the slash and
        // citation menus; let those through (the menu removes its query text afterwards).
        if ((text === '/' || text === '@') && from === to) {
          const $from = view.state.doc.resolve(from);
          const previous = $from.parentOffset ? $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset, undefined, '\ufffc') : '';
          if (!previous || /\s/.test(previous)) return false;
        }
        const tr = view.state.tr;
        let insertAt = to;
        if (to > from) {
          markRemoved(view.state, tr, from, to, config.author);
          insertAt = tr.mapping.map(to);
        }
        const marks = (view.state.storedMarks || view.state.doc.resolve(from).marks())
          .filter((mark) => mark.type !== insert && mark.type !== remove);
        tr.insert(insertAt, view.state.schema.text(text, [...marks, insert.create({ stringValue: valueFor(config.author) })]));
        tr.setSelection(TextSelection.create(tr.doc, insertAt + text.length));
        tr.setMeta(suggestionKey, { internal: true });
        view.dispatch(tr);
        return true;
      },
      handleKeyDown(view, event) {
        const config = getConfig();
        if (!config.enabled || (event.key !== 'Backspace' && event.key !== 'Delete')) return false;
        const { state } = view;
        const { from, to, empty } = state.selection;
        let start = from;
        let end = to;
        if (empty) {
          const $from = state.selection.$from;
          if (event.key === 'Backspace') {
            if ($from.parentOffset === 0) return false; // joining blocks: not tracked
            start = from - 1;
            end = from;
          } else {
            if ($from.parentOffset >= $from.parent.content.size) return false;
            start = from;
            end = from + 1;
          }
        }
        const tr = state.tr;
        markRemoved(state, tr, start, end, config.author);
        const removedOwn = markedValue(state, start, markTypes(state).insert);
        const cursor = event.key === 'Backspace' ? tr.mapping.map(start) : tr.mapping.map(end);
        tr.setSelection(TextSelection.create(tr.doc, Math.max(0, Math.min(cursor, tr.doc.content.size))));
        tr.setMeta(suggestionKey, { internal: true, removedOwn: Boolean(removedOwn) });
        view.dispatch(tr);
        event.preventDefault();
        return true;
      },
    },
    view() {
      return {
        update(view, previous) {
          // A new suggestion starts when the cursor moves somewhere else without typing.
          if (view.state.doc.eq(previous.doc) && !previous.selection.eq(view.state.selection)) sessionValue = null;
        },
      };
    },
  });
}

export const SUGGESTION_CSS = `
  .ce-suggestion-popover { position: absolute; z-index: 13010; display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px;
    background: #fff; border: 1px solid #dadce0; border-radius: 999px; box-shadow: 0 4px 16px rgba(60,64,67,.2); font: 12px/1.3 system-ui, sans-serif; color: #3c4043; }
  .ce-suggestion-popover button { border: 0; background: transparent; cursor: pointer; border-radius: 999px; padding: 4px 10px; font-weight: 600; }
  .ce-suggestion-popover .accept { color: #137333; } .ce-suggestion-popover .accept:hover { background: #e6f4ea; }
  .ce-suggestion-popover .reject { color: #a50e0e; } .ce-suggestion-popover .reject:hover { background: #fce8e6; }
`;
