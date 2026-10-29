'use client';

import { createExtension } from '@blocknote/core';
import type { EditorView } from '@tiptap/pm/view';
import { createPaginationPlugin, type PaginationConfig } from './pagination';
import { createSuggestingPlugin } from './suggestions';
import { createAutocompletePlugin, type GhostState } from './autocomplete';
import { createFindPlugin } from './find';

/**
 * The editor's own ProseMirror plugins (page view, Suggesting mode, autocomplete, find),
 * installed when the editor is created. Adding plugins later reconfigures the editor,
 * and y-prosemirror then destroys the realtime undo history: undo stopped working.
 *
 * Their key handling goes through the editor's direct props, which ProseMirror asks
 * before any plugin, so Tab accepts a suggestion before BlockNote nests a block.
 */

export type EditorPluginHooks = {
  pagination: () => PaginationConfig | null;
  onPages: (pages: number) => void;
  suggesting: () => { enabled: boolean; author: string };
  autocomplete: { onAccept: (ghost: NonNullable<GhostState>) => void; onDismiss: () => void };
};

export const DEFAULT_EDITOR_PLUGIN_HOOKS: EditorPluginHooks = {
  pagination: () => null,
  onPages: () => undefined,
  suggesting: () => ({ enabled: false, author: '' }),
  autocomplete: { onAccept: () => undefined, onDismiss: () => undefined },
};

export function createEditorPlugins(hooks: { current: EditorPluginHooks }) {
  const pagination = createPaginationPlugin(() => hooks.current.pagination(), (pages) => hooks.current.onPages(pages));
  const suggesting = createSuggestingPlugin(() => hooks.current.suggesting());
  const autocomplete = createAutocompletePlugin(() => hooks.current.autocomplete);
  const find = createFindPlugin();
  const extension = createExtension({ key: 'citedEvidenceEditor', prosemirrorPlugins: [pagination, suggesting, autocomplete, find] });
  const editorProps = {
    handleKeyDown(view: EditorView, event: KeyboardEvent) {
      return Boolean(
        autocomplete.props.handleKeyDown?.call(autocomplete, view, event) ||
          suggesting.props.handleKeyDown?.call(suggesting, view, event),
      );
    },
    handleTextInput(view: EditorView, from: number, to: number, text: string) {
      const handle = suggesting.props.handleTextInput as ((view: EditorView, from: number, to: number, text: string) => boolean) | undefined;
      return Boolean(handle?.call(suggesting, view, from, to, text));
    },
  };
  return { extension, editorProps };
}
