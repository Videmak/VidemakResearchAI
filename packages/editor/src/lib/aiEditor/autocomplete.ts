'use client';

import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/**
 * Autocomplete ghost text: a grey continuation shown at the cursor (a widget decoration,
 * so it is never part of the document or the realtime sync). Tab or → at the end accepts
 * it; typing anything else or moving away dismisses it. React asks for suggestions and
 * calls `showGhost`; accepting is React's job too (it inserts real citations).
 */

export const autocompleteKey = new PluginKey<GhostState>('ce-autocomplete');

export type GhostState = { pos: number; text: string; id: number } | null;

type Handlers = {
  onAccept: (ghost: NonNullable<GhostState>) => void;
  onDismiss: () => void;
};

export function showGhost(view: EditorView, pos: number, text: string, id: number) {
  view.dispatch(view.state.tr.setMeta(autocompleteKey, { pos, text, id }));
}

export function clearGhost(view: EditorView | null | undefined) {
  if (!view || !autocompleteKey.getState(view.state)) return;
  view.dispatch(view.state.tr.setMeta(autocompleteKey, null));
}

/**
 * The words of the paragraph at `pos` and where `pos` sits in it, with each inline atom (a
 * citation) as one placeholder: citations get their final label a moment after they are
 * inserted, which does not change what was written.
 */
export function paragraphShape(state: EditorState, pos: number): string | null {
  if (pos < 0 || pos > state.doc.content.size) return null;
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return null;
  const parent = $pos.parent;
  return `${parent.textBetween(0, $pos.parentOffset, ' ', '\u2063')}\u0000${parent.textBetween($pos.parentOffset, parent.content.size, ' ', '\u2063')}`;
}

export function currentGhost(state: EditorState): GhostState {
  return autocompleteKey.getState(state) ?? null;
}

export function createAutocompletePlugin(getHandlers: () => Handlers) {
  return new Plugin<GhostState>({
    key: autocompleteKey,
    state: {
      init: () => null,
      apply(tr, value, oldState, newState) {
        const meta = tr.getMeta(autocompleteKey);
        if (meta !== undefined) return meta;
        if (!value || (!tr.docChanged && !tr.selectionSet)) return value;
        // Edits elsewhere (a citation getting its label, the reference list being rebuilt, a
        // collaborator's typing) keep the suggestion; an edit to its own paragraph or a cursor
        // move away from it makes it stale.
        const mapped = tr.mapping.mapResult(value.pos, 1);
        if (mapped.deleted) return null;
        if (tr.docChanged && paragraphShape(oldState, value.pos) !== paragraphShape(newState, mapped.pos)) return null;
        const { selection } = newState;
        if (!selection.empty || selection.from !== mapped.pos) return null;
        return mapped.pos === value.pos ? value : { ...value, pos: mapped.pos };
      },
    },
    props: {
      decorations(state) {
        const ghost = autocompleteKey.getState(state);
        if (!ghost) return null;
        const widget = Decoration.widget(
          ghost.pos,
          () => {
            const span = document.createElement('span');
            span.className = 'ce-ghost-text';
            span.setAttribute('contenteditable', 'false');
            span.setAttribute('aria-hidden', 'true');
            span.textContent = ghost.text;
            return span;
          },
          { side: 1, key: `ghost-${ghost.id}`, ignoreSelection: true },
        );
        return DecorationSet.create(state.doc, [widget]);
      },
      handleKeyDown(view, event) {
        const ghost = autocompleteKey.getState(view.state);
        if (!ghost) return false;
        if ((event.key === 'Tab' && !event.shiftKey) || (event.key === 'ArrowRight' && view.state.selection.empty && view.state.selection.from === ghost.pos)) {
          event.preventDefault();
          getHandlers().onAccept(ghost);
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          view.dispatch(view.state.tr.setMeta(autocompleteKey, null));
          getHandlers().onDismiss();
          return true;
        }
        return false;
      },
    },
  });
}

export const AUTOCOMPLETE_CSS = `
  .ce-ghost-text { color: #94a3b8; pointer-events: none; user-select: none; white-space: pre-wrap; }
  .ce-ghost-text::after { content: 'Tab'; margin-left: 6px; padding: 0 5px; border: 1px solid #e5e7eb; border-bottom-width: 2px; border-radius: 5px;
    font: 500 11px/15px var(--font-sans), Inter, system-ui, sans-serif; color: #64748b; background: #fff; vertical-align: 2px; }
  @keyframes ce-progress { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
`;
