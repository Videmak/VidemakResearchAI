import type { MetadataRoute } from 'next';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://videmak.net').replace(/\/+$/, '');

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/editor-home`, lastModified, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE_URL}/features`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/how-it-works`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/pricing`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/help`, lastModified, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/citation-styles`, lastModified, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/developers`, lastModified, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/login`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/signup`, lastModified, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${SITE_URL}/contact`, lastModified, changeFrequency: 'yearly', priority: 0.4 },
    ...['terms-and-conditions', 'privacy_policy', 'data-deletion-policy'].map((slug) => (
      { url: `${SITE_URL}/page/${slug}`, lastModified, changeFrequency: 'yearly' as const, priority: 0.3 }
    )),
  ];
}
