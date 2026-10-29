import type { BlockNoteEditor } from '@blocknote/core';

/**
 * Paragraph formatting as Word keeps it: on the paragraph (block props from wordSchema), so it
 * applies with just the cursor in the paragraph and is written to Word on export.
 */
type Editor = BlockNoteEditor<any, any, any>;

/** One indent step: half an inch, as in Word and Docs. */
export const INDENT_STEP_PT = 36;

function targetBlocks(editor: Editor) {
  const selected = editor.getSelection()?.blocks ?? [];
  if (selected.length) return selected;
  try {
    return [editor.getTextCursorPosition().block];
  } catch {
    return [];
  }
}

/** Updates the Word paragraph props of the selected blocks (blocks without them are skipped). */
export function setParagraphProps(editor: Editor, patch: (props: Record<string, any>) => Record<string, string> | null) {
  targetBlocks(editor).forEach((block) => {
    const props = block.props as Record<string, any> | undefined;
    if (!props || !('lineSpacing' in props)) return;
    const next = patch(props);
    if (next) editor.updateBlock(block, { props: next } as any);
  });
}

/** Lists change level; paragraphs and headings move their left indent by half an inch. */
export function changeIndent(editor: Editor, direction: 1 | -1) {
  const blocks = targetBlocks(editor);
  if (blocks[0] && /ListItem$/.test(blocks[0].type)) {
    if (direction > 0 && editor.canNestBlock()) editor.nestBlock();
    if (direction < 0 && editor.canUnnestBlock()) editor.unnestBlock();
    return;
  }
  blocks.forEach((block) => {
    const props = block.props as Record<string, any> | undefined;
    if (!props || !('indentLeft' in props)) return;
    const current = Number.parseFloat(String(props.indentLeft || '0')) || 0;
    // A paragraph nested under another (older documents) comes back out before it outdents.
    if (direction < 0 && current <= 0) {
      if (editor.canUnnestBlock()) editor.unnestBlock();
      return;
    }
    const next = Math.max(0, current + direction * INDENT_STEP_PT);
    editor.updateBlock(block, { props: { indentLeft: next ? String(next) : '' } } as any);
  });
}
