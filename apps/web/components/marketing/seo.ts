import type { Metadata } from 'next';

const SITE_NAME = 'Videmak Research AI';

/** The editor screenshot doubles as the social preview image until a dedicated one exists. */
const OG_IMAGE = {
  url: '/screenshots/editor.png',
  width: 2160,
  height: 1350,
  alt: 'The Videmak editor: a paper with AI autocomplete suggesting a cited sentence, and AI chat beside it',
};

/**
 * Title, description, canonical URL, Open Graph and Twitter tags for a public page.
 * `title` gets the " · Videmak Research AI" suffix from the root layout unless `absolute` is set.
 */
export function pageMetadata({
  title,
  description,
  path,
  absolute = false,
  index = true,
}: {
  title: string;
  description: string;
  path: string;
  absolute?: boolean;
  index?: boolean;
}): Metadata {
  const fullTitle = absolute ? title : `${title} · ${SITE_NAME}`;
  return {
    title: absolute ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    robots: index ? undefined : { index: false, follow: true },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'en_US',
      url: path,
      title: fullTitle,
      description,
      images: [OG_IMAGE],
    },
    twitter: { card: 'summary_large_image', title: fullTitle, description, images: [OG_IMAGE.url] },
  };
}
