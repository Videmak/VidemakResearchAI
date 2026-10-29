'use client';

import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** Find in the document: the matches and the current one, shown as decorations. */

export type Match = { from: number; to: number };
export type FindState = { matches: Match[]; current: number };

export const findKey = new PluginKey<FindState>('ce-find');

export function findMatches(state: EditorState, query: string, matchCase: boolean): Match[] {
  if (!query) return [];
  const needle = matchCase ? query : query.toLowerCase();
  const matches: Match[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Text of the block with non-text inline nodes as one placeholder character.
    const positions: number[] = [];
    let text = '';
    node.forEach((child, offset) => {
      if (child.isText) {
        const value = child.text || '';
        for (let index = 0; index < value.length; index += 1) positions.push(pos + 1 + offset + index);
        text += value;
      } else {
        positions.push(pos + 1 + offset);
        text += '￼';
      }
    });
    const haystack = matchCase ? text : text.toLowerCase();
    let at = haystack.indexOf(needle);
    while (at >= 0 && matches.length < 2000) {
      matches.push({ from: positions[at], to: positions[at + needle.length - 1] + 1 });
      at = haystack.indexOf(needle, at + Math.max(1, needle.length));
    }
    return false;
  });
  return matches;
}

export function createFindPlugin() {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: () => ({ matches: [], current: -1 }),
      apply(tr, value) {
        const meta = tr.getMeta(findKey);
        if (meta) return meta;
        if (!tr.docChanged) return value;
        return {
          matches: value.matches.map((match) => ({ from: tr.mapping.map(match.from), to: tr.mapping.map(match.to) })).filter((match) => match.to > match.from),
          current: value.current,
        };
      },
    },
    props: {
      decorations(state) {
        const value = findKey.getState(state);
        if (!value || !value.matches.length) return null;
        return DecorationSet.create(
          state.doc,
          value.matches.map((match, index) => Decoration.inline(match.from, match.to, { class: index === value.current ? 'ce-find-match ce-find-current' : 'ce-find-match' })),
        );
      },
    },
  });
}

export const FIND_CSS = `
  .ce-find-match { background: #fde293; border-radius: 2px; }
  .ce-find-current { background: #f9ab00; box-shadow: 0 0 0 1px #f9ab00; }
`;

