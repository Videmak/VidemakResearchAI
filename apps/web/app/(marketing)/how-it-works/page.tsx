import Link from 'next/link';
import { pageMetadata } from '@/components/marketing/seo';
import { container } from '@/components/marketing/styles';
import { FinalCta, PageIntro, Points, STEPS, StartButton, isSignedIn } from '@/components/marketing/landing';

export const metadata = pageMetadata({
  title: 'How it works',
  path: '/how-it-works',
  description:
    'From blank page to cited paper in three steps: start or open your Word file, write with cited autocomplete, AI Edit and chat, then review and export to Word, PDF or LaTeX.',
});

// Signed-in visitors see "Open your documents".
export const dynamic = 'force-dynamic';

export default async function HowItWorksPage() {
  const signedIn = await isSignedIn();
  return (
    <>
      <PageIntro title="From blank page to cited paper" intro="Three steps, one editor. Start from your own file, write with AI that cites real papers, and hand in a clean export.">
        <StartButton signedIn={signedIn} />
      </PageIntro>

      <ol className={`${container} flex flex-col gap-20 pt-16 md:gap-28 md:pt-24`}>
        {STEPS.map((step, index) => (
          <li key={step.id} id={step.id} aria-labelledby={`${step.id}-title`} className="grid scroll-mt-8 items-center gap-8 md:grid-cols-2 md:gap-14">
            <div className={index % 2 ? 'md:order-2' : ''}>
              <p className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-full bg-ink text-[15px] font-semibold text-white" aria-hidden="true">{index + 1}</span>
                <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand" aria-hidden="true">{step.icon}</span>
              </p>
              <h2 id={`${step.id}-title`} className="mt-4 text-balance text-[24px] font-semibold leading-[1.2] tracking-[-0.02em] text-ink md:text-[30px]">
                <span className="sr-only">Step {index + 1}: </span>{step.title}
              </h2>
              <p className="mt-3 max-w-[480px] text-[15px] leading-[1.6] text-muted md:text-[16px]">{step.body}</p>
              <Points items={step.points} />
            </div>
            <div className={`min-w-0 rounded-[24px] bg-[#f4f5f7] p-4 sm:p-7 ${index % 2 ? 'md:order-1' : ''}`}>{step.visual}</div>
          </li>
        ))}
      </ol>

      <p className={`${container} pt-16 text-center text-[15px] text-muted md:pt-24`}>
        More about each tool on <Link href="/features" className="text-ink underline underline-offset-4 hover:text-brand">Features</Link>; shortcuts and tips in the <Link href="/help" className="text-ink underline underline-offset-4 hover:text-brand">help center</Link>.
      </p>

      <FinalCta signedIn={signedIn} />
    </>
  );
}
