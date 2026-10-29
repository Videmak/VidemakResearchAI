/**
 * How one in-text citation reads: parenthetical "(Smith et al., 2020)" or narrative
 * "Smith et al. (2020)", with an optional locator ("p. 12"), prefix ("see") and suffix.
 * The citation style gives the plain form; this adds what the writer chose per citation.
 */

export type CitationDecoration = { mode?: string; locator?: string; prefix?: string; suffix?: string };

function firstAuthorLast(bibtex: string): string {
  const match = /author\s*=\s*[{"]([^}"]+)[}"]/i.exec(bibtex || '');
  if (!match) return '';
  const authors = match[1].split(/\s+and\s+/i).map((author) => author.trim()).filter(Boolean);
  const first = authors[0] || '';
  const last = first.includes(',') ? first.split(',')[0].trim() : first.split(/\s+/).pop() || '';
  return authors.length > 2 ? `${last} et al.` : authors.length === 2 ? `${last} & ${(authors[1].includes(',') ? authors[1].split(',')[0] : authors[1].split(/\s+/).pop() || '').trim()}` : last;
}

export function decorateInText(inText: string, decoration: CitationDecoration, bibtex = ''): string {
  const text = (inText || '').trim();
  const locator = (decoration.locator || '').trim();
  const prefix = (decoration.prefix || '').trim();
  const suffix = (decoration.suffix || '').trim();
  const narrative = decoration.mode === 'narrative';
  if (!narrative && !locator && !prefix && !suffix) return inText;

  const numeric = /^\[(.+)\]$/.exec(text);
  if (numeric) {
    const inner = [numeric[1], locator, suffix].filter(Boolean).join(', ');
    const bracket = `[${inner}]`;
    if (narrative) return `${prefix ? `${prefix} ` : ''}${firstAuthorLast(bibtex) || 'Ref.'} ${bracket}`;
    return prefix ? `${prefix} ${bracket}` : bracket;
  }

  const parenthetical = /^\((.+)\)$/.exec(text);
  if (!parenthetical) return inText; // superscripts and unusual styles stay as the style made them
  const core = parenthetical[1];
  const split = /^(.*?),\s*([^,]*\d{4}[a-z]?|n\.d\.)(.*)$/.exec(core);
  if (narrative && split) {
    const year = [split[2] + split[3], locator, suffix].filter(Boolean).join(', ');
    return `${prefix ? `${prefix} ` : ''}${split[1]} (${year})`;
  }
  const inner = [core, locator, suffix].filter(Boolean).join(', ');
  return `(${prefix ? `${prefix} ` : ''}${inner})`;
}
