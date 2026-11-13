/** Where the classic Videmak pages send people. Plain constants, so server pages can use them too. */

export const CE = 'https://citedevidence.com';
export const SUPPORT_EMAIL = 'admin@videmak.org';
export const WHATSAPP = 'https://wa.me/message/ANYPVUK7UMROD1';

/**
 * A CitedEvidence link tagged as coming from Videmak. CitedEvidence keeps utm_source and
 * utm_campaign with each sign-up, so sign-ups and sales from these pages can be counted there.
 */
export function ceLink(path = '/', campaign = 'home') {
  const url = new URL(path, CE);
  url.searchParams.set('utm_source', 'videmak');
  url.searchParams.set('utm_medium', 'referral');
  url.searchParams.set('utm_campaign', campaign);
  return url.toString();
}
