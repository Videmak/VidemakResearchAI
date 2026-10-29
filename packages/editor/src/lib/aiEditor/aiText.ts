'use client';

import type { AssistSource } from './assistApi';

/**
 * Editor paragraphs <-> text for the AI. Citations, footnotes and equations the writer
 * already has become placeholders ([[CITATION_1]], [[NOTE_1]], [[MATH_1]]) that the AI
 * keeps, and come back as the original inline items. New citations arrive as [S1]
 * markers that refer to the numbered sources of the answer.
 */

export type SerializedForAI = {
  text: string;
  /** placeholder -> the original inline item */
  items: Map<string, any>;
};

const PLACEHOLDER = /\[\[(CITATION|NOTE|MATH|ITEM)_\d+\]\]/g;
const SOURCE_MARKER = /\[(S\d+(?:\s*[,;]\s*S?\d+)*)\]/g;

export function serializeInlineForAI(content: unknown): SerializedForAI {
  const items = new Map<string, any>();
  const counts: Record<string, number> = {};
  const parts: string[] = [];
  const add = (kind: string, item: any) => {
    counts[kind] = (counts[kind] || 0) + 1;
    const placeholder = `[[${kind}_${counts[kind]}]]`;
    items.set(placeholder, item);
    parts.push(placeholder);
  };
  (Array.isArray(content) ? content : []).forEach((item: any) => {
    if (!item || typeof item !== 'object') return;
    if (item.type === 'text') {
      // Suggested deletions are not part of the text the writer sees as final.
      if (item.styles?.suggestionDelete) return;
      parts.push(String(item.text ?? ''));
    } else if (item.type === 'link') {
      parts.push((item.content || []).map((child: any) => child.text ?? '').join(''));
    } else if (item.type === 'aiCitation') add('CITATION', item);
    else if (item.type === 'footnote') add('NOTE', item);
    else if (item.type === 'aiMath') add('MATH', item);
    else if (item.type === 'aiMention') parts.push(String(item.props?.displayName ?? ''));
    else add('ITEM', item);
  });
  return { text: parts.join(''), items };
}

/** Plain words of a paragraph as the reader sees them (citations as their display text). */
export function visibleText(content: unknown): string {
  return (Array.isArray(content) ? content : [])
    .map((item: any) => {
      if (item?.type === 'text') return item.styles?.suggestionDelete ? '' : String(item.text ?? '');
      if (item?.type === 'link') return (item.content || []).map((child: any) => child.text ?? '').join('');
      if (item?.type === 'aiCitation') return String(item.props?.displayText ?? '');
      if (item?.type === 'aiMention') return String(item.props?.displayName ?? '');
      return '';
    })
    .join('');
}

export function countWords(text: string) {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length;
}

/**
 * AI text -> inline content per paragraph (blank lines separate paragraphs).
 * `makeCitations` turns the sources of one [S..] marker into aiCitation items.
 */
export function aiTextToInline(
  text: string,
  items: Map<string, any>,
  sources: AssistSource[],
  makeCitations: (sources: AssistSource[]) => any[],
): any[][] {
  const byNumber = new Map(sources.map((source) => [source.n, source]));
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((paragraph) => {
      const inline: any[] = [];
      const pushText = (value: string) => {
        if (!value) return;
        const last = inline[inline.length - 1];
        if (last && last.type === 'text' && Object.keys(last.styles || {}).length === 0) last.text += value;
        else inline.push({ type: 'text', text: value, styles: {} });
      };
      const pattern = new RegExp(`${PLACEHOLDER.source}|${SOURCE_MARKER.source}`, 'g');
      let cursor = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(paragraph))) {
        pushText(paragraph.slice(cursor, match.index));
        cursor = match.index + match[0].length;
        if (match[0].startsWith('[[')) {
          const original = items.get(match[0]);
          if (original) inline.push(original);
          continue;
        }
        const cited = (match[2] || '')
          .split(/[,;]/)
          .map((part) => Number.parseInt(part.replace(/[^\d]/g, ''), 10))
          .map((n) => byNumber.get(n))
          .filter((source): source is AssistSource => Boolean(source && source.bibtex));
        if (cited.length) {
          // "claim [S1]." -> "claim (Smith, 2020)." with one space before the citation.
          const last = inline[inline.length - 1];
          if (last?.type === 'text') last.text = last.text.replace(/\s+$/, '');
          pushText(' ');
          inline.push(...makeCitations(cited));
        }
      }
      pushText(paragraph.slice(cursor));
      return inline;
    });
}

/** Plain preview of AI text (placeholders and markers as readable labels). */
export function previewAIText(text: string, items: Map<string, any>, sources: AssistSource[]) {
  const byNumber = new Map(sources.map((source) => [source.n, source]));
  return text
    .replace(PLACEHOLDER, (placeholder) => {
      const item = items.get(placeholder);
      if (item?.type === 'aiCitation') return String(item.props?.displayText ?? '(citation)');
      if (item?.type === 'footnote') return '¹';
      if (item?.type === 'aiMath') return `$${item.props?.latex ?? ''}$`;
      return '';
    })
    .replace(SOURCE_MARKER, (_match, inner: string) => {
      const labels = inner
        .split(/[,;]/)
        .map((part) => byNumber.get(Number.parseInt(part.replace(/[^\d]/g, ''), 10)))
        .filter(Boolean)
        .map((source) => shortCitation(source as AssistSource));
      return labels.length ? `(${labels.join('; ')})` : '';
    });
}

export function shortCitation(source: Pick<AssistSource, 'authors' | 'year'>) {
  const first = (source.authors?.[0] || 'Unknown').trim();
  const last = first.includes(',') ? first.split(',')[0] : first.split(/\s+/).pop() || first;
  const etal = (source.authors?.length || 0) > 2 ? ' et al.' : (source.authors?.length || 0) === 2 ? ` & ${(source.authors[1] || '').split(/\s+/).pop()}` : '';
  return `${last}${etal}, ${source.year || 'n.d.'}`;
}

/** Replaces [S1] markers inside parsed blocks (e.g. a Markdown chat answer) with citations. */
export function replaceSourceMarkersInBlocks(
  blocks: any[],
  sources: AssistSource[],
  makeCitations: (sources: AssistSource[]) => any[],
): any[] {
  const byNumber = new Map(sources.map((source) => [source.n, source]));
  const replaceContent = (content: any[]): any[] =>
    content.flatMap((item: any) => {
      if (item?.type === 'link') return [item];
      if (item?.type !== 'text' || !SOURCE_MARKER.test(item.text)) {
        SOURCE_MARKER.lastIndex = 0;
        return [item];
      }
      SOURCE_MARKER.lastIndex = 0;
      const out: any[] = [];
      let cursor = 0;
      const pattern = new RegExp(SOURCE_MARKER.source, 'g');
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(item.text))) {
        const before = item.text.slice(cursor, match.index).replace(/\s+$/, '');
        if (before) out.push({ ...item, text: `${before} ` });
        cursor = match.index + match[0].length;
        const cited = match[1]
          .split(/[,;]/)
          .map((part) => byNumber.get(Number.parseInt(part.replace(/[^\d]/g, ''), 10)))
          .filter((source): source is AssistSource => Boolean(source && source.bibtex));
        out.push(...makeCitations(cited));
      }
      const rest = item.text.slice(cursor);
      if (rest) out.push({ ...item, text: rest });
      return out;
    });
  return blocks.map((block) => ({
    ...block,
    content: Array.isArray(block.content) ? replaceContent(block.content) : block.content,
    children: Array.isArray(block.children) ? replaceSourceMarkersInBlocks(block.children, sources, makeCitations) : block.children,
  }));
}
