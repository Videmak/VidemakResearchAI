'use client';

import type { EditorView } from '@tiptap/pm/view';

/**
 * The ProseMirror view once the editor is mounted (TipTap throws before that). Not
 * `editor.headless`: TipTap only marks itself initialized a tick after the view exists,
 * and BlockNote's mount event fires before that, so a check in between missed both.
 */
export function safeView(editor: any): EditorView | null {
  try {
    const view = editor?._tiptapEditor?.view as EditorView | undefined;
    return view && view.dom ? view : null;
  } catch {
    return null;
  }
}

// Plugins are installed when the editor is created (editorExtension.ts). Registering one
// later reconfigures the editor, and y-prosemirror then destroys the realtime undo history.
