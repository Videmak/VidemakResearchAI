/** Turns a Zotero API item into a BibTeX entry (used when importing a Zotero library). */
const TYPE_MAP: Record<string, string> = {
  journalArticle: 'article', book: 'book', bookSection: 'incollection', conferencePaper: 'inproceedings',
  thesis: 'phdthesis', report: 'techreport', webpage: 'misc', preprint: 'misc', manuscript: 'unpublished',
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const escape = (value: string) => value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();

export function zoteroItemToBibtex(item: Record<string, unknown>, index: number): string | null {
  const title = text(item.title) || 'Untitled';
  const type = TYPE_MAP[text(item.itemType)] || 'misc';
  const year = (text(item.date).match(/\b(1[5-9]\d\d|20\d\d)\b/) || [])[0] || '';
  const creators = Array.isArray(item.creators) ? (item.creators as Record<string, unknown>[]) : [];
  const authors = creators
    .filter((creator) => ['author', 'editor'].includes(text(creator.creatorType) || 'author'))
    .map((creator) => (text(creator.lastName) ? `${text(creator.lastName)}, ${text(creator.firstName)}`.replace(/,\s*$/, '') : text(creator.name)))
    .filter(Boolean);
  const seed = (authors[0] || title).split(/[,\s]/)[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'ref';
  const key = `${seed}${year || 'nd'}${index + 1}`;
  const fields: [string, string][] = [
    ['title', title], ['author', authors.join(' and ')], ['year', year],
    ['journal', text(item.publicationTitle)], ['booktitle', text(item.proceedingsTitle) || text(item.bookTitle)],
    ['publisher', text(item.publisher)], ['volume', text(item.volume)], ['number', text(item.issue)],
    ['pages', text(item.pages)], ['doi', text(item.DOI)], ['url', text(item.url)],
  ];
  const body = fields.filter(([, value]) => value).map(([name, value]) => `  ${name} = {${escape(value)}}`).join(',\n');
  return body ? `@${type}{${key},\n${body}\n}` : null;
}
