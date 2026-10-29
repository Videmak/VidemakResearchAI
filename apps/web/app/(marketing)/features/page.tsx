import Link from 'next/link';
import { pageMetadata } from '@/components/marketing/seo';
import { container, focusRing } from '@/components/marketing/styles';
import { AudienceSection, ComparisonBand, FEATURES, FinalCta, PageIntro, Points, StartButton, isSignedIn } from '@/components/marketing/landing';

export const metadata = pageMetadata({
  title: 'Features',
  path: '/features',
  description:
    'Autocomplete that cites real papers, Find papers across 250M+ works, chat with your PDFs, AI review with Major and Minor comments, Word, PDF and LaTeX export, and a real editor on your phone.',
});

// Signed-in visitors see "Open your documents".
export const dynamic = 'force-dynamic';

export default async function FeaturesPage() {
  const signedIn = await isSignedIn();
  return (
    <>
      <PageIntro title="Everything you need to write a paper" intro="Write, cite, review and export in one editor, with every reference a real paper.">
        <StartButton signedIn={signedIn} />
      </PageIntro>

      {/* Jump links to each feature. */}
      <nav aria-label="Features on this page" className={`${container} pt-10`}>
        <ul className="mx-auto flex max-w-[860px] flex-wrap justify-center gap-2">
          {FEATURES.map((feature) => (
            <li key={feature.id}>
              <a href={`#${feature.id}`} className={`inline-flex h-9 items-center gap-2 rounded-full border border-line bg-white px-3.5 text-[13.5px] text-ink-2 hover:border-brand-100 hover:text-brand ${focusRing}`}>
                <span className="text-brand [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">{feature.icon}</span>{feature.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className={`${container} flex flex-col gap-20 pt-16 md:gap-28 md:pt-24`}>
        {FEATURES.map((feature, index) => (
          <section key={feature.id} id={feature.id} aria-labelledby={`${feature.id}-title`} className="grid scroll-mt-8 items-center gap-8 md:grid-cols-2 md:gap-14">
            <div className={index % 2 ? 'md:order-2' : ''}>
              <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand" aria-hidden="true">{feature.icon}</span>
              <h2 id={`${feature.id}-title`} className="mt-4 text-balance text-[24px] font-semibold leading-[1.2] tracking-[-0.02em] text-ink md:text-[30px]">{feature.title}</h2>
              <p className="mt-3 max-w-[460px] text-[15px] leading-[1.6] text-muted md:text-[16px]">{feature.body}</p>
              <Points items={feature.points} />
            </div>
            <div className={`min-w-0 rounded-[24px] bg-[#f4f5f7] p-4 sm:p-7 ${index % 2 ? 'md:order-1' : ''}`}>{feature.visual}</div>
          </section>
        ))}
      </div>

      <ComparisonBand />
      <AudienceSection />

      <p className={`${container} pt-12 text-center text-[15px] text-muted`}>
        See the steps in <Link href="/how-it-works" className="text-ink underline underline-offset-4 hover:text-brand">How it works</Link>, or every shortcut in the <Link href="/help" className="text-ink underline underline-offset-4 hover:text-brand">help center</Link>.
      </p>

      <FinalCta signedIn={signedIn} />
    </>
  );
}
