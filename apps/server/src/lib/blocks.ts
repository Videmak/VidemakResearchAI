/** Plain text of BlockNote blocks, for search, word counts and AI context. */
export function blocksToText(blocks: unknown): string {
  const out: string[] = [];
  const walkInline = (content: unknown): string => {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map((item: any) => (typeof item?.text === 'string' ? item.text : walkInline(item?.content))).join('');
  };
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const block of list as any[]) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'table' && block.content?.rows) {
        for (const row of block.content.rows) for (const cell of row.cells || []) out.push(walkInline(cell?.content ?? cell));
      } else {
        const line = walkInline(block.content);
        if (line) out.push(line);
      }
      walk(block.children);
    }
  };
  walk(blocks);
  return out.join('\n');
}

export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}

export function countBlocks(blocks: unknown): number {
  if (!Array.isArray(blocks)) return 0;
  return blocks.reduce((total: number, block: any) => total + 1 + countBlocks(block?.children), 0);
}
