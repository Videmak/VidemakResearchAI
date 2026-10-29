import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

function isPrivateAddress(address: string) {
  if (isIP(address) === 4) return PRIVATE_V4.some((pattern) => pattern.test(address));
  const lower = address.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80') || lower.startsWith('::ffff:');
}

/** True only for https URLs whose host resolves to public addresses (blocks requests into our own network). */
export async function isPublicHttpsUrl(raw: string): Promise<boolean> {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && !isIP(host)) return false;
  if (isIP(host)) return !isPrivateAddress(host);
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}

/** fetch() that follows up to 5 redirects, re-checking every hop with isPublicHttpsUrl. */
export async function fetchPublic(raw: string, init: RequestInit = {}): Promise<Response> {
  let url = raw;
  for (let hop = 0; hop < 6; hop += 1) {
    if (!(await isPublicHttpsUrl(url))) throw new Error('This link cannot be fetched.');
    const response = await fetch(url, { ...init, redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url).toString();
      continue;
    }
    return response;
  }
  throw new Error('Too many redirects.');
}
