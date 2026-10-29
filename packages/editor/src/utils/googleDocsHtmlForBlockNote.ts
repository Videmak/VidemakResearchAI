/**
 * Normalizes clipboard HTML from Google Docs, Microsoft Word, and similar sources
 * so BlockNote can parse page breaks, headings, lists, and inline formatting reliably.
 */

const GOOGLE_DOCS_HINT =
  /docs-internal-guid|id=["']docs-internal-guid|Google Docs|google-docs-content/i;
const OFFICE_HINT = /xmlns:w=|Word\.Document|MsoNormal|MsoListParagraph|mso-list:/i;

function isGoogleDocsLike(html: string, root: HTMLElement): boolean {
  if (GOOGLE_DOCS_HINT.test(html)) return true;
  const meta = root.ownerDocument.querySelector('meta[name="generator"]');
  const gen = meta?.getAttribute('content') ?? '';
  return /Google Docs/i.test(gen);
}

function isOfficeLike(html: string): boolean {
  return OFFICE_HINT.test(html);
}

function shouldApplyRichFormatting(html: string, gdocs: boolean, office: boolean): boolean {
  return (
    gdocs ||
    office ||
    /mso-|page-break|break-before:\s*page|break-after:\s*page|docs-internal-guid/i.test(html)
  );
}

/** Remove Word/Office fragments that confuse the DOM or add empty blocks. */
function stripOfficeXmlNoise(html: string): string {
  return (
    html
      .replace(/<\?xml[^?]*\?>/gi, '')
      /* Word conditional comments */
      .replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '')
      /* Empty Office paragraph stubs */
      .replace(/<o:p>\s*<\/o:p>/gi, '')
      .replace(/<w:[^>]+\/>/gi, '')
      .replace(/<v:[^>]+\/>/gi, '')
  );
}

function unwrapGoogleRedirectLinks(root: HTMLElement): void {
  root.querySelectorAll('a[href*="google.com/url"]').forEach((node) => {
    const a = node as HTMLAnchorElement;
    try {
      const u = new URL(a.href);
      const q = u.searchParams.get('q') ?? u.searchParams.get('url');
      if (q) {
        a.href = decodeURIComponent(q);
      }
    } catch {
      /* keep original */
    }
  });
}

function fontSizePt(style: string): number | null {
  const m = /font-size:\s*([\d.]+)\s*pt/i.exec(style);
  return m ? parseFloat(m[1]) : null;
}

function fontSizePx(style: string): number | null {
  const m = /font-size:\s*([\d.]+)\s*px/i.exec(style);
  return m ? parseFloat(m[1]) : null;
}

function isBoldStyle(style: string): boolean {
  return (
    /font-weight:\s*(700|bold|bolder)/i.test(style) || /font-weight:\s*[6-9]\d{2}/i.test(style)
  );
}

function mergeTextAlign(target: HTMLElement, from: HTMLElement): void {
  const pAlign = from.style.textAlign;
  if (pAlign && (pAlign === 'center' || pAlign === 'right' || pAlign === 'justify')) {
    target.style.textAlign = pAlign;
  }
}

function isEffectivelyEmptyForPageBreak(el: HTMLElement): boolean {
  const raw = el.textContent?.replace(/\u00a0/g, ' ').replace(/\u200b/g, '') ?? '';
  const t = raw.trim();
  if (t === '') return true;
  /* Word often leaves a single nbsp or bullet placeholder */
  if (/^[\s\u00a0·•\-\*]+$/.test(t) && t.length <= 3) return true;
  return false;
}

function styleHasPageBreakBefore(style: string): boolean {
  return (
    /page-break-before:\s*always/i.test(style) ||
    /break-before:\s*page/i.test(style) ||
    /mso-break-type:\s*section-break/i.test(style)
  );
}

function styleHasPageBreakAfter(style: string): boolean {
  return /page-break-after:\s*always/i.test(style) || /break-after:\s*page/i.test(style);
}

function insertPageBreakBefore(doc: Document, node: Node): void {
  const div = doc.createElement('div');
  div.setAttribute('data-page-break', '');
  node.parentNode?.insertBefore(div, node);
}

function insertPageBreakAfter(doc: Document, node: Node): void {
  const div = doc.createElement('div');
  div.setAttribute('data-page-break', '');
  if (node.nextSibling) {
    node.parentNode?.insertBefore(div, node.nextSibling);
  } else {
    node.parentNode?.appendChild(div);
  }
}

function stripPageBreakFromStyle(el: HTMLElement): void {
  const st = el.getAttribute('style') ?? '';
  if (!st) return;
  const next = st
    .replace(/page-break-before:\s*always;?/gi, '')
    .replace(/page-break-after:\s*always;?/gi, '')
    .replace(/break-before:\s*page;?/gi, '')
    .replace(/break-after:\s*page;?/gi, '')
    .replace(/mso-break-type:\s*section-break;?/gi, '')
    .replace(/;\s*;/g, ';')
    .replace(/^\s*;\s*|\s*;\s*$/g, '')
    .trim();
  if (next) el.setAttribute('style', next);
  else el.removeAttribute('style');
}

/**
 * Map Word/GDocs page-break markup to BlockNote's `data-page-break` blocks.
 */
function convertPageBreakElements(doc: Document, root: HTMLElement): void {
  /* HR used as section/page break */
  root.querySelectorAll('hr').forEach((hr) => {
    const st = hr.getAttribute('style') ?? '';
    if (
      /page-break|break-before:\s*page|break-after:\s*page|section-break/i.test(st) ||
      hr.className.toLowerCase().includes('page')
    ) {
      const div = doc.createElement('div');
      div.setAttribute('data-page-break', '');
      hr.replaceWith(div);
    }
  });

  /* BR with explicit page / section break (Word) */
  root.querySelectorAll('br').forEach((br) => {
    const st = br.getAttribute('style') ?? '';
    const clear = br.getAttribute('clear') ?? '';
    if (
      styleHasPageBreakBefore(st) ||
      /mso-special-character:\s*section-break/i.test(st) ||
      (/mso-special-character:\s*line-break/i.test(st) && styleHasPageBreakBefore(st)) ||
      (clear.toUpperCase() === 'ALL' && /page-break-before:\s*always/i.test(st))
    ) {
      const div = doc.createElement('div');
      div.setAttribute('data-page-break', '');
      br.replaceWith(div);
    }
  });

  /* Empty (or placeholder) paragraphs/divs that only force a new page */
  const blockSelectors = 'p, div';
  root.querySelectorAll(blockSelectors).forEach((el) => {
    if (el.closest('td, th, li')) return;
    const htmlEl = el as HTMLElement;
    const st = htmlEl.getAttribute('style') ?? '';
    if (!styleHasPageBreakBefore(st) && !styleHasPageBreakAfter(st)) return;

    const before = styleHasPageBreakBefore(st);
    const after = styleHasPageBreakAfter(st);

    if (before && isEffectivelyEmptyForPageBreak(htmlEl)) {
      const div = doc.createElement('div');
      div.setAttribute('data-page-break', '');
      htmlEl.replaceWith(div);
      return;
    }

    if (before && !isEffectivelyEmptyForPageBreak(htmlEl)) {
      insertPageBreakBefore(doc, htmlEl);
      stripPageBreakFromStyle(htmlEl);
    }
    if (after) {
      insertPageBreakAfter(doc, htmlEl);
      stripPageBreakFromStyle(htmlEl);
    }
  });
}

function mergeAdjacentPageBreaks(root: HTMLElement): void {
  const removeDuplicateFollowingBreaks = (node: Node) => {
    let child = node.firstChild;
    while (child) {
      const next = child.nextSibling;
      if (child instanceof HTMLElement) {
        if (child.hasAttribute('data-page-break')) {
          let s = child.nextSibling;
          while (s) {
            if (s.nodeType === Node.TEXT_NODE && !(s.textContent?.trim())) {
              const afterText = s.nextSibling;
              s.remove();
              s = afterText;
              continue;
            }
            if (s instanceof HTMLElement && s.hasAttribute('data-page-break')) {
              const toRemove = s;
              s = s.nextSibling;
              toRemove.remove();
              continue;
            }
            break;
          }
        }
        removeDuplicateFollowingBreaks(child);
      }
      child = next;
    }
  };
  removeDuplicateFollowingBreaks(root);
}

function promoteStyledParagraphsToHeadings(doc: Document, root: HTMLElement): void {
  const paragraphs = Array.from(root.querySelectorAll('p'));

  for (const p of paragraphs) {
    if (p.closest('li, td, th')) continue;

    const text = p.textContent?.replace(/\u00a0/g, ' ').trim() ?? '';
    if (!text || text.length > 400) continue;

    const pStyle = p.getAttribute('style') ?? '';
    const directSpan = p.querySelector(':scope > span');
    const spanStyle = directSpan?.getAttribute('style') ?? '';

    const fs = fontSizePt(spanStyle) ?? fontSizePx(spanStyle) ?? fontSizePt(pStyle) ?? fontSizePx(pStyle);
    const bold = isBoldStyle(spanStyle) || isBoldStyle(pStyle);
    const children = Array.from(p.childNodes).filter(
      (n) => n.nodeType !== Node.TEXT_NODE || (n.textContent?.trim() ?? '').length > 0,
    );
    const onlySpansAndText =
      children.length > 0 &&
      children.every((n) => n.nodeType === Node.TEXT_NODE || (n as HTMLElement).tagName === 'SPAN');

    if (!onlySpansAndText) continue;

    let level = 0;
    if (fs != null) {
      if (fs >= 22) level = 1;
      else if (fs >= 18) level = 2;
      else if (fs >= 15) level = 3;
      else if (fs >= 13) level = 4;
      else if (fs >= 11) level = 5;
      else level = 6;
    } else if (bold && text.length <= 120) {
      level = text.length <= 40 ? 2 : 3;
    }

    if (level === 0) continue;

    const tag = `h${Math.min(6, Math.max(1, level))}`;
    const h = doc.createElement(tag);
    mergeTextAlign(h, p);
    h.innerHTML = p.innerHTML;
    p.replaceWith(h);
  }
}

/** Leaf-only: span with italic → em */
function normalizeItalicSpans(root: HTMLElement): void {
  root.querySelectorAll('span[style*="font-style"]').forEach((span) => {
    const st = span.getAttribute('style') ?? '';
    if (!/font-style:\s*italic/i.test(st) && !/font-style:\s*oblique/i.test(st)) return;
    if (span.children.length > 0) return;
    const em = span.ownerDocument.createElement('em');
    em.textContent = span.textContent;
    preserveInlineStyles(span as HTMLSpanElement, em, ['fontStyle']);
    span.replaceWith(em);
  });
}

/** Leaf-only: underline */
function normalizeUnderlineSpans(root: HTMLElement): void {
  root.querySelectorAll('span[style*="text-decoration"], span[style*="text-underline"]').forEach((span) => {
    const st = span.getAttribute('style') ?? '';
    if (!/underline/.test(st)) return;
    if (/line-through/.test(st)) return;
    if (span.children.length > 0) return;
    const u = span.ownerDocument.createElement('u');
    u.textContent = span.textContent;
    preserveInlineStyles(span as HTMLSpanElement, u, ['textDecoration', 'textDecorationLine']);
    span.replaceWith(u);
  });
}

/** Leaf-only: strikethrough */
function normalizeStrikethroughSpans(root: HTMLElement): void {
  root.querySelectorAll('span[style*="text-decoration"], span[style*="line-through"]').forEach((span) => {
    const st = span.getAttribute('style') ?? '';
    if (!/line-through/.test(st)) return;
    if (span.children.length > 0) return;
    const s = span.ownerDocument.createElement('s');
    s.textContent = span.textContent;
    preserveInlineStyles(span as HTMLSpanElement, s, ['textDecoration', 'textDecorationLine']);
    span.replaceWith(s);
  });
}

function normalizeBoldSpans(root: HTMLElement): void {
  root.querySelectorAll('span[style*="font-weight"]').forEach((span) => {
    const st = span.getAttribute('style') ?? '';
    if (!isBoldStyle(st)) return;
    if (span.children.length > 0) return;
    const strong = span.ownerDocument.createElement('strong');
    strong.textContent = span.textContent;
    preserveInlineStyles(span as HTMLSpanElement, strong, ['fontWeight']);
    span.replaceWith(strong);
  });
}

function preserveInlineStyles(
  source: HTMLSpanElement,
  target: HTMLElement,
  omitKeys: Array<keyof CSSStyleDeclaration> = [],
): void {
  const allowedKeys: Array<keyof CSSStyleDeclaration> = [
    'color',
    'backgroundColor',
    'fontSize',
    'fontFamily',
    'lineHeight',
    'verticalAlign',
    'textDecorationColor',
  ];

  for (const key of allowedKeys) {
    if (omitKeys.includes(key)) {
      continue;
    }

    const value = source.style[key];
    if (typeof value === 'string' && value.trim()) {
      (target.style as any)[key] = value;
    }
  }
}

function normalizeSuperscriptAndSubscriptSpans(root: HTMLElement): void {
  root
    .querySelectorAll('span[style*="vertical-align"], span[style*="mso-text-raise"], span[style*="position"]')
    .forEach((span) => {
      const st = (span.getAttribute('style') ?? '').toLowerCase();
      if (span.children.length > 0) return;

      const isSuperscript =
        /vertical-align:\s*super/.test(st) ||
        /mso-text-raise:\s*\d/.test(st) ||
        (/position:\s*relative/.test(st) && /top:\s*-\d/.test(st));
      const isSubscript =
        /vertical-align:\s*sub/.test(st) ||
        (/position:\s*relative/.test(st) && /top:\s*\d/.test(st));

      if (!isSuperscript && !isSubscript) return;

      const replacement = span.ownerDocument.createElement(isSuperscript ? 'sup' : 'sub');
      replacement.textContent = span.textContent;
      preserveInlineStyles(span as HTMLSpanElement, replacement, ['verticalAlign']);
      span.replaceWith(replacement);
    });
}

function isWordListParagraph(el: Element): el is HTMLParagraphElement {
  if (el.tagName !== 'P') return false;
  const cls = el.getAttribute('class') ?? '';
  return /MsoListParagraph/i.test(cls) || /MsoList/i.test(cls);
}

function extractStyleLength(style: string, propertyName: string): number | null {
  const match = new RegExp(`${propertyName}:\\s*([\\d.]+)\\s*(pt|px)`, 'i').exec(style);
  if (!match) return null;
  const numeric = Number.parseFloat(match[1]);
  if (!Number.isFinite(numeric)) return null;
  return match[2].toLowerCase() === 'pt' ? numeric * (4 / 3) : numeric;
}

function detectWordListLevel(paragraph: HTMLParagraphElement): number {
  const style = paragraph.getAttribute('style') ?? '';
  const explicitLevel = /level(\d+)/i.exec(style);
  if (explicitLevel) {
    return Math.max(0, Number.parseInt(explicitLevel[1], 10) - 1);
  }

  const marginLeft = extractStyleLength(style, 'margin-left') ?? 0;
  if (marginLeft <= 0) {
    return 0;
  }

  return Math.max(0, Math.round(marginLeft / 36));
}

function detectWordListType(paragraph: HTMLParagraphElement): 'ol' | 'ul' {
  const style = paragraph.getAttribute('style') ?? '';
  const text = paragraph.textContent?.replace(/\u00a0/g, ' ').trim() ?? '';

  if (/mso-list:\s*l\d+\s+level\d+\s+lfo\d+/i.test(style) && /^\(?(\d+|[a-z]+|[ivxlcdm]+)[.)]/i.test(text)) {
    return 'ol';
  }

  if (/^\(?(\d+|[a-z]+|[ivxlcdm]+)[.)]\s+/i.test(text)) {
    return 'ol';
  }

  return 'ul';
}

function stripWordListMarker(paragraph: HTMLParagraphElement): string {
  const clone = paragraph.cloneNode(true) as HTMLParagraphElement;

  clone.querySelectorAll('span').forEach((span) => {
    const style = span.getAttribute('style') ?? '';
    if (/mso-list:\s*Ignore/i.test(style)) {
      span.remove();
    }
  });

  for (const node of Array.from(clone.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE) {
      continue;
    }

    const raw = node.textContent ?? '';
    const cleaned = raw.replace(/^\s*(?:[•·◦▪■\-*]+|\(?\d+[\.\)]|[a-zA-Z][\.\)]|[ivxlcdm]+[\.\)])\s+/i, '');
    if (cleaned !== raw) {
      node.textContent = cleaned;
    }
    break;
  }

  return clone.innerHTML;
}

/**
 * Word often uses <p class="MsoListParagraph"> without <ul>/<ol>. Group consecutive
 * sibling list paragraphs under one <ul> so BlockNote can parse list items.
 */
function wrapWordListParagraphsInParent(doc: Document, parent: HTMLElement): void {
  const children = Array.from(parent.childNodes);
  let i = 0;
  while (i < children.length) {
    const node = children[i];
    if (!(node instanceof HTMLParagraphElement) || !isWordListParagraph(node) || node.closest('li')) {
      i += 1;
      continue;
    }
    const group: HTMLParagraphElement[] = [];
    let j = i;
    while (j < children.length) {
      const n = children[j];
      if (n instanceof HTMLParagraphElement && isWordListParagraph(n) && !n.closest('li')) {
        group.push(n);
        j += 1;
      } else {
        break;
      }
    }
    if (group.length >= 1) {
      const fragment = doc.createDocumentFragment();
      const stack: Array<{ level: number; type: 'ol' | 'ul'; list: HTMLOListElement | HTMLUListElement }> = [];

      for (const p of group) {
        const level = Math.max(0, detectWordListLevel(p));
        const type = detectWordListType(p);

        while (stack.length > level + 1) {
          stack.pop();
        }

        if (stack.length > level && stack[stack.length - 1]?.level >= level) {
          stack.pop();
        }

        while (stack.length < level) {
          const parentList = stack[stack.length - 1]?.list;
          if (!parentList) {
            break;
          }
          let parentLi = parentList.lastElementChild as HTMLLIElement | null;
          if (!parentLi) {
            parentLi = doc.createElement('li');
            parentList.appendChild(parentLi);
          }
          const nestedList = doc.createElement(type) as HTMLOListElement | HTMLUListElement;
          parentLi.appendChild(nestedList);
          stack.push({ level: stack.length, type, list: nestedList });
        }

        let currentList = stack[stack.length - 1];
        if (!currentList || currentList.level !== level || currentList.type !== type) {
          const list = doc.createElement(type) as HTMLOListElement | HTMLUListElement;
          if (stack.length === 0) {
            fragment.appendChild(list);
          } else {
            let parentLi = stack[stack.length - 1].list.lastElementChild as HTMLLIElement | null;
            if (!parentLi) {
              parentLi = doc.createElement('li');
              stack[stack.length - 1].list.appendChild(parentLi);
            }
            parentLi.appendChild(list);
          }
          currentList = { level, type, list };
          stack.push(currentList);
        }

        const li = doc.createElement('li');
        li.innerHTML = stripWordListMarker(p);
        const align = p.style.textAlign;
        if (align) {
          li.style.textAlign = align;
        }
        currentList.list.appendChild(li);
      }

      parent.insertBefore(fragment, group[0]);
      for (const p of group) p.remove();
      i = j;
      continue;
    }
    i += 1;
  }
}

function wrapWordListParagraphs(doc: Document, root: HTMLElement): void {
  const walk = (el: HTMLElement) => {
    for (const child of Array.from(el.children)) {
      if (child instanceof HTMLElement) walk(child);
    }
    wrapWordListParagraphsInParent(doc, el);
  };
  walk(root);
}

function preserveWordBlockFormatting(root: HTMLElement): void {
  root.querySelectorAll('p, div, li, td, th, blockquote').forEach((node) => {
    const el = node as HTMLElement;
    const style = el.getAttribute('style') ?? '';
    if (!style) return;

    const lineHeight = /line-height:\s*([^;]+)/i.exec(style)?.[1]?.trim();
    if (lineHeight && !el.style.lineHeight) {
      el.style.lineHeight = lineHeight;
    }

    const textAlign = /text-align:\s*([^;]+)/i.exec(style)?.[1]?.trim().toLowerCase();
    if (textAlign && ['left', 'center', 'right', 'justify'].includes(textAlign) && !el.style.textAlign) {
      el.style.textAlign = textAlign;
    }
  });
}

function convertWordTitleParagraphs(doc: Document, root: HTMLElement): void {
  root.querySelectorAll('p').forEach((node) => {
    const p = node as HTMLParagraphElement;
    if (p.closest('li, td, th')) return;

    const className = p.getAttribute('class') ?? '';
    const style = p.getAttribute('style') ?? '';
    const lowerClassName = className.toLowerCase();
    const lowerStyle = style.toLowerCase();
    let tagName: string | null = null;

    if (lowerClassName.includes('msotitle') || lowerStyle.includes('mso-style-name:"title"')) {
      tagName = 'h1';
    } else if (
      lowerClassName.includes('msosubtitle') ||
      lowerStyle.includes('mso-style-name:"subtitle"') ||
      lowerStyle.includes("mso-style-name:'subtitle'")
    ) {
      tagName = 'h2';
    }

    if (!tagName) return;

    const replacement = doc.createElement(tagName);
    mergeTextAlign(replacement, p);
    replacement.innerHTML = p.innerHTML;
    p.replaceWith(replacement);
  });
}

function normalizeTableCellAttributes(root: HTMLElement): void {
  root.querySelectorAll('td, th').forEach((node) => {
    const cell = node as HTMLElement;

    const textAlign = cell.style.textAlign?.trim().toLowerCase();
    if (textAlign && ['left', 'center', 'right', 'justify'].includes(textAlign)) {
      cell.setAttribute('data-text-alignment', textAlign);
    }

    const backgroundColor = cell.style.backgroundColor?.trim();
    if (backgroundColor) {
      cell.setAttribute('data-background-color', backgroundColor);
    }

    const textColor = cell.style.color?.trim();
    if (textColor) {
      cell.setAttribute('data-text-color', textColor);
    }

    const colspan = cell.getAttribute('colspan');
    if (colspan && Number(colspan) <= 1) {
      cell.removeAttribute('colspan');
    }

    const rowspan = cell.getAttribute('rowspan');
    if (rowspan && Number(rowspan) <= 1) {
      cell.removeAttribute('rowspan');
    }
  });
}

/**
 * Call for any substantial `text/html` clipboard payload before `editor.pasteHTML`.
 */
export function preprocessRichDocumentHtml(html: string): string {
  if (typeof window === 'undefined' || !html.trim()) {
    return html;
  }

  try {
    const cleaned = stripOfficeXmlNoise(html);
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleaned, 'text/html');
    const root = doc.body;
    if (!root) return html;

    unwrapGoogleRedirectLinks(root);

    const gdocs = isGoogleDocsLike(cleaned, root);
    const office = isOfficeLike(cleaned);
    const rich = shouldApplyRichFormatting(cleaned, gdocs, office);

    convertPageBreakElements(doc, root);
    mergeAdjacentPageBreaks(root);

    if (rich) {
      /* Order matters: preserve block styles first, then inline semantics. */
      preserveWordBlockFormatting(root);
      normalizeTableCellAttributes(root);
      convertWordTitleParagraphs(doc, root);
      normalizeSuperscriptAndSubscriptSpans(root);
      normalizeStrikethroughSpans(root);
      normalizeUnderlineSpans(root);
      normalizeItalicSpans(root);
      wrapWordListParagraphs(doc, root);
      promoteStyledParagraphsToHeadings(doc, root);
      normalizeBoldSpans(root);
    }

    return root.innerHTML;
  } catch {
    return html;
  }
}
