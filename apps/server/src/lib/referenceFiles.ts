/**
 * Reference files and pasted identifiers for the Library: BibTeX (.bib), RIS (.ris) and lists of
 * DOIs, PubMed ids and arXiv ids. Pure functions; the Library import turns the results into rows.
 */

export type ReferenceItem = {
  title: string;
  authors: string[];
  year: string | null;
  doi: string | null;
  journal: string | null;
  url: string | null;
  abstract: string | null;
  /** A key from the source file (BibTeX key, RIS ID), kept in metadata. */
  key: string | null;
  /** The whole entry as BibTeX, for citing in exactly the style it came in. */
  bibtex: string | null;
};

const clean = (value: string | undefined | null) => {
  if (!value) return null;
  const text = value
    .replace(/\\[`'^"~=.uvHtcdbk]\{?([A-Za-z])\}?/g, '$1') // accents: \'{e} → e
    .replace(/\\&/g, '&').replace(/\\%/g, '%').replace(/\\_/g, '_').replace(/~/g, ' ')
    .replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  return text || null;
};

export const cleanDoi = (value: string | null | undefined) => {
  const doi = String(value ?? '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
};

/** "Rasch, Björn and Born, Jan" → ["Björn Rasch", "Jan Born"]. */
function bibtexAuthors(value: string | null): string[] {
  if (!value) return [];
  return value.split(/\s+and\s+/i).map((name) => {
    const [last, first] = name.split(',').map((part) => part.trim());
    return clean(first ? `${first} ${last}` : last) ?? '';
  }).filter(Boolean);
}

/** Reads every @entry{key, field = {…} | "…" | 123, …} in a .bib file; @string/@comment/@preamble are skipped. */
export function parseBibtex(text: string): ReferenceItem[] {
  const items: ReferenceItem[] = [];
  let index = 0;
  while ((index = text.indexOf('@', index)) !== -1) {
    const header = /^@\s*([A-Za-z]+)\s*([{(])/.exec(text.slice(index));
    if (!header) { index += 1; continue; }
    const type = header[1].toLowerCase();
    const open = index + header[0].length - 1;
    const close = header[2] === '{' ? '}' : ')';
    // Find the matching closing brace, minding nested braces and quoted values.
    let depth = 0;
    let end = -1;
    let quoted = false;
    for (let i = open; i < text.length; i += 1) {
      const char = text[i];
      if (char === '"' && text[i - 1] !== '\\' && depth === 1) quoted = !quoted;
      if (quoted) continue;
      if (char === '{' || char === '(') depth += 1;
      else if (char === '}' || char === ')') { depth -= 1; if (depth === 0 && char === close) { end = i; break; } }
    }
    if (end === -1) break;
    const body = text.slice(open + 1, end);
    const raw = text.slice(index, end + 1);
    index = end + 1;
    if (['string', 'comment', 'preamble'].includes(type)) continue;
    const comma = body.indexOf(',');
    const key = comma === -1 ? body.trim() : body.slice(0, comma).trim();
    const fields: Record<string, string> = {};
    const rest = comma === -1 ? '' : body.slice(comma + 1);
    let position = 0;
    while (position < rest.length) {
      const match = /\s*([A-Za-z][\w-]*)\s*=\s*/y;
      match.lastIndex = position;
      const found = match.exec(rest);
      if (!found) break;
      position = match.lastIndex;
      const name = found[1].toLowerCase();
      let value = '';
      if (rest[position] === '{') {
        let level = 0;
        const start = position;
        for (; position < rest.length; position += 1) {
          if (rest[position] === '{') level += 1;
          else if (rest[position] === '}') { level -= 1; if (level === 0) { position += 1; break; } }
        }
        value = rest.slice(start + 1, position - 1);
      } else if (rest[position] === '"') {
        const start = position + 1;
        position = start;
        while (position < rest.length && !(rest[position] === '"' && rest[position - 1] !== '\\')) position += 1;
        value = rest.slice(start, position);
        position += 1;
      } else {
        const bare = /[^,\s}]+/y;
        bare.lastIndex = position;
        value = bare.exec(rest)?.[0] ?? '';
        position = bare.lastIndex || position + 1;
      }
      fields[name] = value;
      const separator = /\s*(#[^,]*)?,?/y;
      separator.lastIndex = position;
      separator.exec(rest);
      position = Math.max(separator.lastIndex, position);
    }
    const title = clean(fields.title) || clean(fields.booktitle);
    if (!title) continue;
    items.push({
      title,
      authors: bibtexAuthors(fields.author || fields.editor || null),
      year: /\d{4}/.exec(fields.year || fields.date || '')?.[0] ?? null,
      doi: cleanDoi(fields.doi),
      journal: clean(fields.journal || fields.journaltitle || fields.booktitle || fields.publisher),
      url: clean(fields.url),
      abstract: clean(fields.abstract),
      key: key || null,
      bibtex: raw,
    });
  }
  return items;
}

/** Reads RIS records (TY … ER). */
export function parseRis(text: string): ReferenceItem[] {
  const items: ReferenceItem[] = [];
  let record: Record<string, string[]> = {};
  const finish = () => {
    const first = (...tags: string[]) => tags.map((tag) => record[tag]?.[0]).find(Boolean) ?? null;
    const title = clean(first('TI', 'T1', 'CT', 'BT'));
    if (title) {
      items.push({
        title,
        authors: [...(record.AU || []), ...(record.A1 || [])].map((name) => {
          const [last, firstName] = name.split(',').map((part) => part.trim());
          return firstName ? `${firstName} ${last}` : last;
        }).filter(Boolean),
        year: /\d{4}/.exec(first('PY', 'Y1', 'DA') || '')?.[0] ?? null,
        doi: cleanDoi(first('DO')),
        journal: clean(first('JO', 'T2', 'JF', 'JA', 'PB')),
        url: clean(first('UR', 'L2')),
        abstract: clean(first('AB', 'N2')),
        key: clean(first('ID')),
        bibtex: null,
      });
    }
    record = {};
  };
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const match = /^([A-Z][A-Z0-9])  - ?(.*)$/.exec(line);
    if (!match) continue;
    const [, tag, value] = match;
    if (tag === 'ER') { finish(); continue; }
    if (tag === 'TY') record = {};
    (record[tag] ||= []).push(value.trim());
  }
  if (Object.keys(record).length) finish();
  return items;
}

export type PastedId = { kind: 'doi' | 'pmid' | 'arxiv'; value: string };

/** DOIs (or doi.org links), PubMed ids ("PMID: 123", or bare 5–9 digit numbers) and arXiv ids, one per line or separated by commas. */
export function parseIds(text: string): PastedId[] {
  const seen = new Set<string>();
  const ids: PastedId[] = [];
  for (const raw of text.split(/[\s,;]+/).map((part) => part.trim()).filter(Boolean)) {
    let id: PastedId | null = null;
    const doi = cleanDoi(raw.replace(/[.)\]]+$/, ''));
    const arxiv = /^(?:arxiv:|https?:\/\/arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5})(v\d+)?(?:\.pdf)?$/i.exec(raw);
    const pmid = /^(?:pmid:?|https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/)?(\d{5,9})\/?$/i.exec(raw);
    if (doi) id = { kind: 'doi', value: doi };
    else if (arxiv) id = { kind: 'arxiv', value: arxiv[1] };
    else if (pmid) id = { kind: 'pmid', value: pmid[1] };
    if (!id) continue;
    const key = `${id.kind}:${id.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }
  return ids;
}
