import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import pages from '@/content/legal-pages.json';

/** The old site's policy pages (/page/terms-and-conditions, /page/privacy_policy, …), text as it was. */

type LegalPage = { slug: string; title: string; html: string; updated: string };
const PAGES = pages as LegalPage[];

export const dynamicParams = false;

export function generateStaticParams() {
  return PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = PAGES.find((item) => item.slug === slug);
  if (!page) return {};
  return { title: { absolute: `${page.title} - Videmak Research AI` }, alternates: { canonical: `https://videmak.net/page/${page.slug}` } };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = PAGES.find((item) => item.slug === slug);
  if (!page) notFound();
  return (
    <>
      <div className="bg-[#f8fafc] px-4 pb-12 pt-36 text-center">
        <p className="text-[12px]"><Link href="/" className="text-[#0d6efd]">Home</Link> / <span className="text-[#6b7280]">{page.title}</span></p>
        <h1 className="mt-2 text-[30px] font-bold text-[#1e1e2d]">{page.title}</h1>
      </div>
      <div className="classic-prose mx-auto max-w-[1140px] px-4 py-14 text-[15px] leading-[1.7] text-[#1e1e2d]" dangerouslySetInnerHTML={{ __html: page.html }} />
    </>
  );
}
