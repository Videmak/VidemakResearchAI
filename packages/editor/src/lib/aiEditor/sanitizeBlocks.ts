/**
 * Stored blocks that this editor cannot show (a style, inline item, prop or block type it does
 * not know, e.g. written by a newer version, an API client or an unusual Word file) would stop
 * the whole document from opening. They are reduced to what the schema knows instead: unknown
 * styles are dropped (superscript/subscript become verticalAlign), unknown inline items become
 * their text and unknown blocks become paragraphs.
 */
type Schema = {
  blockSchema: Record<string, { propSchema?: Record<string, unknown> }>;
  inlineContentSchema: Record<string, unknown>;
  styleSchema: Record<string, unknown>;
};

function cleanStyles(styles: Record<string, unknown> | undefined, schema: Schema) {
  const out: Record<string, unknown> = {};
  Object.entries(styles || {}).forEach(([name, value]) => {
    if (name in schema.styleSchema) out[name] = value;
    else if ((name === 'superscript' || name === 'subscript') && value && 'verticalAlign' in schema.styleSchema) {
      out.verticalAlign = name === 'superscript' ? 'super' : 'sub';
    }
  });
  return out;
}

function textOfItem(item: any): string {
  if (typeof item === 'string') return item;
  if (typeof item?.text === 'string') return item.text;
  if (Array.isArray(item?.content)) return item.content.map(textOfItem).join('');
  return String(item?.props?.text || item?.props?.displayText || item?.props?.latex || '');
}

function cleanInline(content: unknown, schema: Schema): any[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((item: any) => {
    if (typeof item === 'string') return [item];
    if (!item || typeof item !== 'object') return [];
    if (item.type === 'text') return [{ ...item, text: String(item.text ?? ''), styles: cleanStyles(item.styles, schema) }];
    if (item.type === 'link' && 'link' in schema.inlineContentSchema) {
      return [{ ...item, content: cleanInline(item.content, schema).filter((part) => typeof part === 'string' || part.type === 'text') }];
    }
    if (item.type in schema.inlineContentSchema) return [item];
    const fallback = textOfItem(item);
    return fallback ? [{ type: 'text', text: fallback, styles: {} }] : [];
  });
}

function cleanTable(content: any, schema: Schema) {
  return {
    ...content,
    rows: (content.rows || []).map((row: any) => ({
      ...row,
      cells: (row.cells || []).map((cell: any) =>
        Array.isArray(cell) ? cleanInline(cell, schema) : { ...cell, content: cleanInline(cell?.content, schema) },
      ),
    })),
  };
}

function cleanBlock(block: any, schema: Schema): any {
  if (!block || typeof block !== 'object') return null;
  const known = schema.blockSchema[block.type];
  const type = known ? block.type : 'paragraph';
  const propSchema = schema.blockSchema[type]?.propSchema || {};
  const props = Object.fromEntries(Object.entries(known ? block.props || {} : {}).filter(([name]) => name in propSchema));
  let content: unknown = block.content;
  if (content && typeof content === 'object' && !Array.isArray(content) && (content as any).type === 'tableContent') {
    content = type === 'table' ? cleanTable(content, schema) : [];
  } else if (Array.isArray(content)) {
    content = cleanInline(content, schema);
  }
  const children = Array.isArray(block.children) ? block.children.map((child: any) => cleanBlock(child, schema)).filter(Boolean) : [];
  return { ...block, type, props, ...(content !== undefined ? { content } : {}), children };
}

export function sanitizeBlocksForSchema(blocks: unknown, schema: Schema): any[] {
  return Array.isArray(blocks) ? blocks.map((block) => cleanBlock(block, schema)).filter(Boolean) : [];
}
