/**
 * What a PDF says about itself (document properties and the first page), kept only when it looks
 * like real bibliographic data: titles such as "Microsoft Word - draft.docx" or authors such as
 * "Admin" are what word processors leave behind, not the paper's.
 */
const JUNK_TITLE = /^(untitled|microsoft (word|powerpoint)\b|document\d*$|slide \d+|title$|presentation\d*$|print$)|\.(docx?|pdf|tex|odt|pptx?|indd)$/i;
const JUNK_AUTHOR = /^(admin(istrator)?|user|owner|author|unknown|microsoft|windows user|pc|default|guest|[a-z]{1,3}\d*)$/i;

export function pdfTitle(value: unknown): string | null {
  const title = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (title.length < 8 || title.length > 400 || JUNK_TITLE.test(title) || !/[a-z]{3}/i.test(title)) return null;
  return title;
}

export function pdfAuthors(value: unknown): string[] {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  return text
    .split(/\s*;\s*|\s+and\s+|\s*&\s*/i)
    .map((name) => name.trim())
    .filter((name) => name.length >= 4 && name.length <= 120 && /[a-z]/i.test(name) && /\s|,/.test(name) && !JUNK_AUTHOR.test(name))
    .slice(0, 50);
}

/** The first DOI printed on the page (articles carry theirs on page one). */
export function pdfDoi(firstPageText: string): string | null {
  const match = /\b(10\.\d{4,9}\/[-._;()/:a-z0-9]+[a-z0-9])/i.exec(firstPageText.slice(0, 6000));
  return match ? match[1] : null;
}
