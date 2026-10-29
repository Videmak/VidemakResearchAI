/**
 * Canonical CSL-JSON normalization.
 *
 * Saved workspaces contain several generations of citation payloads. Some
 * author values are direct CSL names, some are nested under `name`, and a few
 * legacy records contain empty objects. citeproc must never receive those
 * shapes directly: one invalid name can abort rendering of the whole article.
 */

export type CslName = {
  family?: string;
  given?: string;
  literal?: string;
  suffix?: string;
  'dropping-particle'?: string;
  'non-dropping-particle'?: string;
};

const NAME_VARIABLES = [
  'author',
  'editor',
  'translator',
  'collection-editor',
  'container-author',
  'original-author',
  'reviewed-author',
] as const;

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned || undefined;
}

function objectValue(
  value: Record<string, unknown>,
  nested: Record<string, unknown> | null,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const direct = cleanText(value[key]);
    if (direct) return direct;
    const nestedValue = nested ? cleanText(nested[key]) : undefined;
    if (nestedValue) return nestedValue;
  }
  return undefined;
}

export function normalizeCslName(value: unknown): CslName | null {
  if (typeof value === 'string') {
    const literal = cleanText(value);
    return literal ? { literal } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const nested = record.name && typeof record.name === 'object' && !Array.isArray(record.name)
    ? record.name as Record<string, unknown>
    : null;
  const literal = objectValue(record, nested, 'literal')
    || (typeof record.name === 'string' ? cleanText(record.name) : undefined);
  if (literal) return { literal };

  const family = objectValue(record, nested, 'family', 'lastName', 'last_name');
  const given = objectValue(record, nested, 'given', 'firstName', 'first_name');
  if (!family && !given) return null;

  const normalized: CslName = {};
  if (family) normalized.family = family;
  if (given) normalized.given = given;
  for (const field of ['suffix', 'dropping-particle', 'non-dropping-particle'] as const) {
    const fieldValue = objectValue(record, nested, field);
    if (fieldValue) normalized[field] = fieldValue;
  }
  return normalized;
}

/**
 * Article numbers ("e16905", PLoS/Frontiers) are stored as "e16905-e16905" by some sources.
 * They are one number, not a range, and styles that shorten page ranges (Chicago) crash on a
 * letter-prefixed range inside citeproc. A range with the same ends becomes one value; a
 * letter-prefixed range keeps its first number.
 */
export function normalizeCslPage(page: unknown): unknown {
  if (typeof page !== 'string') return page;
  const match = /^\s*([^\s\u2013\u2014-]+)\s*[-\u2013\u2014]+\s*([^\s\u2013\u2014-]+)\s*$/.exec(page);
  if (!match) return page;
  const [, first, last] = match;
  if (first === last || /[a-z]/i.test(first) || /[a-z]/i.test(last)) return first;
  return page;
}

export function normalizeCslItem<T extends Record<string, any>>(item: T): T {
  const normalized = { ...item } as Record<string, any>;
  if ('page' in normalized) normalized.page = normalizeCslPage(normalized.page);
  for (const variable of NAME_VARIABLES) {
    const raw = normalized[variable];
    if (raw === undefined || raw === null) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    const names = values
      .map(normalizeCslName)
      .filter((name): name is CslName => name !== null);
    if (names.length > 0) normalized[variable] = names;
    else delete normalized[variable];
  }
  return normalized as T;
}

export function normalizeCslItems(items: unknown): Array<Record<string, any>> {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is Record<string, any> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map(normalizeCslItem);
}
