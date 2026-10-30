import Image from 'next/image';
import Link from 'next/link';
import { LuArrowRight, LuBlocks, LuGitPullRequest, LuGithub, LuPlus, LuServer, LuShieldCheck, LuSparkles, LuSquarePen } from 'react-icons/lu';
import { AutocompleteVisual } from '@/components/marketing/LandingVisuals';
import { AuthAware } from '@/components/marketing/AuthAware';
import { PricingTeaser } from '@/components/marketing/PricingTeaser';
import { loadPublicPlans } from '@/components/marketing/plans';
import { pageMetadata } from '@/components/marketing/seo';
import { btnGhost, btnPrimary, container, focusRing, GITHUB_URL } from '@/components/marketing/styles';
import { FEATURES, FinalCta, STEPS, StartButton, h2, isSignedIn, lead } from '@/components/marketing/landing';

const DESCRIPTION =
  'Write your paper faster, with citations you can trust. Autocomplete with real references, 250M+ papers, AI review before you submit, and Word and LaTeX export. Free to start.';

export const metadata = pageMetadata({ title: 'Videmak Research AI — the AI editor for academic writing', absolute: true, path: '/', description: DESCRIPTION });

// Rendered per request (signed-in visitors see Dashboard); the plans themselves are cached for 5 minutes.
export const dynamic = 'force-dynamic';

const FACTS = [
  { value: '250M+', label: 'Scholarly works to cite' },
  { value: '10,000+', label: 'Citation styles' },
  { value: 'Any device', label: 'Phone, tablet, desktop' },
];

const FAQ = [
  { q: 'Is it free to start?', a: 'Yes. The free plan includes the full editor and a daily AI allowance. Upgrade when you need more.' },
  { q: 'Are the citations real?', a: 'Yes. Papers come from scholarly databases, not the AI’s memory. Click any citation to open the paper.' },
  { q: 'Will my writing be used to train AI?', a: 'Videmak does not train AI on your documents. They stay private to you and the people you share them with.' },
  { q: "Can I use my university's Word template?", a: 'Yes. Open the .docx and Videmak keeps its styles, headers and page setup when you export.' },
  { q: 'Which citation styles are there?', a: 'APA, MLA, Chicago, Harvard, IEEE, Vancouver and over 10,000 more journal styles.' },
  { q: 'Can I cancel any time?', a: 'Yes. Cancel from your account; your plan stays until the end of the period you paid for.' },
  { q: 'Does it work on my phone?', a: 'Yes. Videmak runs in the browser on phones, tablets and computers, with your work synced.' },
  { q: 'Can I write with others?', a: 'Yes. Share a document by link and write together in real time, with comments.' },
  { q: 'Is Videmak open source?', a: 'Yes. The whole app is on GitHub under the MIT licence: the editor, the server and the converter. Use it here, or run it on your own servers.' },
];

const OPEN_SOURCE = [
  { icon: <LuServer className="h-5 w-5" />, title: 'Run it yourself', body: 'One docker compose up, on your laptop or your university’s servers.', href: `${GITHUB_URL}#self-host-in-five-minutes`, link: 'Self-hosting guide' },
  { icon: <LuBlocks className="h-5 w-5" />, title: 'Build on it', body: 'The editor is a React package. One Videmak Cloud key adds papers, full text and AI.', href: '/developers', link: 'For developers' },
  { icon: <LuGitPullRequest className="h-5 w-5" />, title: 'Make it better', body: 'Report a bug, suggest a feature or send a pull request.', href: `${GITHUB_URL}/issues`, link: 'Open an issue' },
];

const STRUCTURED_DATA = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Videmak Research AI',
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web, iOS, Android, Windows, macOS',
    description: DESCRIPTION,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    license: 'https://opensource.org/licenses/MIT',
    sameAs: [GITHUB_URL],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
  },
];

const more = `inline-flex items-center gap-1.5 rounded text-[14.5px] font-medium text-brand hover:text-brand-600 ${focusRing}`;

export default async function LandingPage() {
  const [plans, signedIn] = await Promise.all([loadPublicPlans(), isSignedIn()]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }} />

      {/* Hero */}
      <section aria-labelledby="hero-title" className="pt-14 text-center md:pt-20" style={{ background: 'radial-gradient(900px 380px at 50% -8%, #eff6ff 0%, rgba(239,246,255,0) 70%)' }}>
        <div className={container}>
          <p className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-[12.5px] font-medium text-ink-2">
            <LuSparkles className="h-3.5 w-3.5 text-brand" aria-hidden="true" /> The AI editor for academic writing
          </p>
          <h1 id="hero-title" className="mx-auto mt-5 max-w-[760px] text-balance text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] text-ink sm:text-[44px] md:text-[52px]">
            Write your paper faster, with{' '}
            <span className="bg-[linear-gradient(transparent_62%,#dbeafe_62%)] px-1">citations you can trust</span>
          </h1>
          <p className={`mx-auto mt-5 max-w-[520px] text-balance ${lead}`}>
            Autocomplete with real references, 250M+ papers to cite and an AI review before you submit. Export to Word or LaTeX.
          </p>
          <div className="mt-7 flex justify-center"><StartButton signedIn={signedIn} /></div>
          <AuthAware initial={signedIn} signedIn={null} signedOut={<p className="mt-3 text-[13px] text-subtle">Free plan · No credit card</p>} />
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={`mt-2 inline-flex items-center gap-1.5 rounded text-[13px] font-medium text-muted transition-colors hover:text-ink ${focusRing}`}>
            <LuGithub className="h-3.5 w-3.5" aria-hidden="true" /> Open source on GitHub · MIT
          </a>
          <div className="relative mx-auto mt-12 max-w-[1000px] md:mt-14">
            <div className="overflow-hidden rounded-t-[12px] border border-b-0 border-line bg-white shadow-[0_40px_80px_-44px_rgba(15,23,42,.45)] md:rounded-t-[16px]">
              <div className="flex h-8 items-center gap-[7px] border-b border-line bg-line-2 px-3 md:h-9" aria-hidden="true">
                <i className="size-2 rounded-full bg-slate-300 md:size-2.5" />
                <i className="size-2 rounded-full bg-slate-300 md:size-2.5" />
                <i className="size-2 rounded-full bg-slate-300 md:size-2.5" />
                <span className="mx-auto flex h-5 min-w-0 items-center rounded-[6px] bg-white px-2.5 font-mono text-[10.5px] text-muted md:text-[11.5px]">videmak.net/editor</span>
              </div>
              {/* Phones and small tablets: crop to the document so the autocomplete is readable; full editor from 768px. */}
              <div className="aspect-[3/2] overflow-hidden md:aspect-auto">
                <Image
                  src="/screenshots/editor.png"
                  alt="The Videmak editor: a paper on sleep and memory with an autocomplete suggestion that already cites Diekelmann & Born (2010), and AI chat beside it listing two well-cited studies to add."
                  width={2160}
                  height={1350}
                  priority
                  sizes="(min-width: 1048px) 1000px, (min-width: 768px) calc(100vw - 48px), calc(189vw - 60px)"
                  className="-ml-[32%] -mt-[15.5%] block h-auto w-[189%] max-w-none md:m-0 md:w-full md:max-w-full"
                />
              </div>
            </div>
            {/* Floating callouts on wide screens. */}
            <div aria-hidden="true" className="absolute -left-14 top-[54%] hidden w-[220px] rounded-xl border border-line bg-white p-3 text-left shadow-[0_24px_50px_-24px_rgba(15,23,42,.45)] xl:block">
              <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-green-700"><LuShieldCheck className="h-3.5 w-3.5" /> Citation checked</p>
              <p className="mt-1 text-[12.5px] font-semibold text-ink">The memory function of sleep</p>
              <p className="text-[11.5px] text-muted">Diekelmann &amp; Born · 2010</p>
            </div>
            <div aria-hidden="true" className="absolute -right-14 top-[46%] hidden w-[205px] rounded-xl border border-line bg-white p-3 text-left shadow-[0_24px_50px_-24px_rgba(15,23,42,.45)] xl:block">
              <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-brand-600"><LuSquarePen className="h-3.5 w-3.5" /> AI review</p>
              <p className="mt-1.5 text-[12px] leading-snug text-ink-2"><span className="rounded bg-red-50 px-1.5 py-0.5 text-[10.5px] font-bold text-red-700">Major</span> Claim needs a source</p>
              <p className="mt-1.5 text-[12px] leading-snug text-ink-2"><span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-800">Minor</span> Split this sentence</p>
            </div>
          </div>
        </div>
      </section>

      {/* Facts */}
      <section aria-label="Videmak at a glance" className={`${container} pt-14 md:pt-20`}>
        <ul className="mx-auto grid max-w-[840px] grid-cols-3 rounded-[20px] border border-line bg-white py-6 shadow-[0_20px_40px_-32px_rgba(15,23,42,.35)] md:py-9">
          {FACTS.map((fact, index) => (
            <li key={fact.label} className={`px-2 text-center ${index ? 'border-l border-line-2' : ''}`}>
              <p className="whitespace-nowrap text-[18px] font-semibold tracking-[-0.03em] text-ink sm:text-[28px] md:text-[40px]">{fact.value}</p>
              <p className="mt-1 text-balance text-[12px] text-muted sm:text-[13.5px]">{fact.label}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Features: a short overview; the full tour is on /features. */}
      <section aria-labelledby="features-title" className={`${container} pt-24 md:pt-32`}>
        <div className="grid items-center gap-10 md:grid-cols-[1fr_1.1fr] md:gap-14">
          <div>
            <h2 id="features-title" className={h2}>Everything you need to write a paper</h2>
            <p className={`mt-4 max-w-[440px] ${lead}`}>Every suggestion comes with a real reference, and every reference opens the paper behind it.</p>
            <Link href="/features" className={`mt-6 ${more}`}>See all features <LuArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </div>
          <div className="min-w-0 rounded-[24px] bg-[#f4f5f7] p-4 sm:p-7"><AutocompleteVisual /></div>
        </div>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li key={feature.id}>
              <Link href={`/features#${feature.id}`} className={`group flex h-full flex-col rounded-[20px] border border-line bg-white p-5 transition-shadow hover:shadow-[0_20px_40px_-30px_rgba(15,23,42,.45)] ${focusRing}`}>
                <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand" aria-hidden="true">{feature.icon}</span>
                <h3 className="mt-4 text-[16px] font-semibold text-ink">{feature.name}</h3>
                <p className="mt-1 text-[14.5px] leading-[1.55] text-muted">{feature.short}</p>
                <span className="mt-auto inline-flex items-center gap-1 pt-4 text-[13.5px] font-medium text-brand">Learn more <LuArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* How it works: three steps; details on /how-it-works. */}
      <section aria-labelledby="how-title" className={`${container} pt-24 text-center md:pt-32`}>
        <h2 id="how-title" className={`mx-auto max-w-[620px] ${h2}`}>From blank page to cited paper</h2>
        <ol className="mx-auto mt-10 grid max-w-[920px] gap-8 md:mt-12 md:grid-cols-3 md:gap-10">
          {STEPS.map((step, index) => (
            <li key={step.id}>
              <span className="mx-auto grid size-11 place-items-center rounded-full border border-line bg-white text-brand shadow-[0_8px_20px_-14px_rgba(15,23,42,.4)]" aria-hidden="true">{step.icon}</span>
              <h3 className="mt-4 text-[16px] font-semibold text-ink"><span className="text-subtle">{index + 1}. </span>{step.title}</h3>
              <p className="mx-auto mt-1.5 max-w-[260px] text-[15px] leading-[1.6] text-muted">{step.short}</p>
            </li>
          ))}
        </ol>
        <Link href="/how-it-works" className={`mt-9 ${more}`}>See how it works <LuArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </section>

      {/* Open source */}
      <section aria-labelledby="open-title" className={`${container} pt-24 md:pt-32`}>
        <div className="rounded-[28px] border border-line bg-[#f8fafc] px-5 py-12 text-center sm:px-10 md:py-16">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-ink text-white" aria-hidden="true"><LuGithub className="h-6 w-6" /></span>
          <h2 id="open-title" className={`mx-auto mt-5 max-w-[620px] ${h2}`}>Open source, MIT licensed</h2>
          <p className={`mx-auto mt-4 max-w-[560px] ${lead}`}>The whole app is on GitHub: the editor, the server and the converter. Write here, run it on your own servers, or build it into your product.</p>
          <ul className="mx-auto mt-10 grid max-w-[920px] gap-4 text-left md:grid-cols-3">
            {OPEN_SOURCE.map((item) => (
              <li key={item.title} className="flex flex-col rounded-[20px] border border-line bg-white p-5">
                <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand" aria-hidden="true">{item.icon}</span>
                <h3 className="mt-4 text-[16px] font-semibold text-ink">{item.title}</h3>
                <p className="mt-1 flex-1 text-[14.5px] leading-[1.55] text-muted">{item.body}</p>
                {item.href.startsWith('http')
                  ? <a href={item.href} target="_blank" rel="noreferrer" className={`mt-4 ${more}`}>{item.link} <LuArrowRight className="h-4 w-4" aria-hidden="true" /></a>
                  : <Link href={item.href} className={`mt-4 ${more}`}>{item.link} <LuArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
              </li>
            ))}
          </ul>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={`${btnPrimary} h-11 px-5 text-[15px]`}><LuGithub className="h-4 w-4" aria-hidden="true" />View on GitHub</a>
            <Link href="/developers" className={`${btnGhost} h-11 px-5 text-[15px]`}>Developers</Link>
          </div>
        </div>
      </section>

      <PricingTeaser plans={plans} />

      {/* FAQ */}
      <section id="faq" aria-labelledby="faq-title" className={`${container} scroll-mt-6 pt-24 md:pt-36`}>
        <div className="grid gap-8 md:grid-cols-[1fr_1.6fr] md:gap-16">
          <div>
            <h2 id="faq-title" className={h2}>Questions</h2>
            <p className="mt-3 text-[15px] text-muted">
              More in the <Link href="/help" className="text-ink underline underline-offset-4 hover:text-brand">help center</Link>.
            </p>
          </div>
          <div className="border-t border-line">
            {FAQ.map((item) => (
              <details key={item.q} className="group border-b border-line">
                <summary className={`flex cursor-pointer list-none items-center gap-4 py-5 text-[16px] font-medium text-ink [&::-webkit-details-marker]:hidden ${focusRing}`}>
                  <h3 className="flex-1">{item.q}</h3>
                  <LuPlus className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-45" aria-hidden="true" />
                </summary>
                <p className="-mt-1 pb-5 pr-8 text-[15px] leading-[1.6] text-muted">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <FinalCta signedIn={signedIn} />
    </>
  );
}
