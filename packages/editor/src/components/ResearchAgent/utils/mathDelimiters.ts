import { decodeBasicHtmlEntities, normalizeLatexSource } from './renderingSanitizers';

type MathRenderer = (latex: string, display: boolean, raw: string) => string;

/** Single-dollar math is ambiguous with money. Explicit \\( ... \\) is not. */
function isInlineMath(body: string, after: string): boolean {
  if (!body.trim() || /^\s|\s$/.test(body) || /\r|\n/.test(body)) return false;
  if (/^\d/.test(after) || /^\d[\d,.]*$/.test(body)) return false;
  // Markdown table boundaries and escaped HTML are never equation content.
  if (/\s\|\s|<\/?[a-z][\w:-]*(?:\s|>)/i.test(decodeBasicHtmlEntities(body))) return false;
  return true;
}

function replaceInText(text: string, render: MathRenderer): string {
  let result = '';
  for (let i = 0; i < text.length;) {
    const rest = text.slice(i);
    // Leave code examples and escaped dollar signs untouched.
    const code = rest.match(/^```[\s\S]*?```|^`[^`\n]*`/);
    if (code) { result += code[0]; i += code[0].length; continue; }
    if (rest.startsWith('\\$')) { result += rest.slice(0, 2); i += 2; continue; }
    const explicit = rest.match(/^\$\$([\s\S]+?)\$\$|^\\{1,2}\[([\s\S]+?)\\{1,2}\]|^\\{1,2}\(([\s\S]+?)\\{1,2}\)/);
    if (explicit) {
      const latex = explicit[1] ?? explicit[2] ?? explicit[3];
      result += render(normalizeLatexSource(decodeBasicHtmlEntities(latex)).trim(), explicit[3] === undefined, explicit[0]);
      i += explicit[0].length;
      continue;
    }
    if (text[i] === '$' && text[i - 1] !== '$' && text[i + 1] !== '$') {
      let end = i + 1;
      while (end < text.length && (text[end] !== '$' || text[end - 1] === '\\')) end++;
      const body = text.slice(i + 1, end);
      if (end < text.length && text[end + 1] !== '$' && isInlineMath(body, text.slice(end + 1))) {
        result += render(normalizeLatexSource(decodeBasicHtmlEntities(body)).trim(), false, text.slice(i, end + 1));
        i = end + 1;
        continue;
      }
    }
    result += text[i++];
  }
  return result;
}

/**
 * Process text islands only. A delimiter cannot consume a table cell boundary,
 * an attribute, a citation or an already-rendered math/code node. No DOM rewrite
 * is needed, so unrelated markup stays byte-for-byte unchanged (also on SSR).
 */
export function transformLatexInHtml(html: string, render: MathRenderer): string {
  const tags = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][\w:-]*(?=[\s/>])(?:"[^"]*"|'[^']*'|[^'">])*?>/gi;
  const protectedStack: string[] = [];
  const voidTags = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'source', 'area', 'base', 'embed', 'param', 'track', 'col']);
  let result = '', offset = 0;
  for (const match of html.matchAll(tags)) {
    const index = match.index!;
    const text = html.slice(offset, index);
    result += protectedStack.length ? text : replaceInText(text, render);
    const tag = match[0];
    const name = tag.match(/^<\/?([\w:-]+)/)?.[1].toLowerCase();
    if (name) {
      if (tag.startsWith('</')) {
        const at = protectedStack.lastIndexOf(name);
        if (at >= 0) protectedStack.splice(at);
      } else if (!voidTags.has(name) && !tag.endsWith('/>')) {
        const protectedNode = /^(?:pre|code|script|style|textarea|math)$/i.test(name)
          || /\bdata-(?:latex|mermaid|citation(?:-id)?)\s*=|\bclass\s*=\s*["'][^"']*\bkatex/i.test(tag);
        if (protectedStack.length || protectedNode) protectedStack.push(name);
      }
    }
    result += tag;
    offset = index + tag.length;
  }
  const tail = html.slice(offset);
  return result + (protectedStack.length ? tail : replaceInText(tail, render));
}

export function hasDelimitedMath(html: string): boolean {
  let found = false;
  transformLatexInHtml(html, (_latex, _display, raw) => { found = true; return raw; });
  return found;
}
