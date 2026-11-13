import type { Metadata } from 'next';
import Link from 'next/link';
import {
  LuArrowRight, LuBadgeCheck, LuBookOpen, LuBrain, LuChartColumn, LuClipboardList, LuFileOutput, LuFilePen, LuFileSearch, LuFileText, LuFiles,
  LuFolderOpen, LuLayers, LuListChecks, LuQuote, LuScanSearch, LuSearch, LuShuffle, LuSparkles, LuStickyNote, LuWandSparkles,
} from 'react-icons/lu';
import { RotatingHeadline } from '@/components/classic/ClassicParts';
import { ceLink } from '@/components/classic/links';

/**
 * videmak.net's home page, kept word for word as the old site showed it (owner's choice,
 * 2026-11-13): Videmak Research AI is now CitedEvidence, with every tool and guide linking
 * there. The AI editor's own landing page is /editor-home.
 */

export const metadata: Metadata = {
  title: { absolute: 'Videmak Research AI - Do Hours of Research in minutes' },
  description: 'Do hours of research in minutes with advanced AI based research tools',
  keywords: ['Videmak Research AI', 'Advanced ChatGPT', 'AI Literature review', 'AI in Research', 'Research Tools', 'Research in Academia'],
  authors: [{ name: 'Videmak' }],
  alternates: { canonical: 'https://videmak.net' },
  openGraph: { title: 'Videmak Research AI - Do Hours of Research in minutes', description: 'Do hours of research in minutes with advanced AI based research tools', url: 'https://videmak.net', siteName: 'Videmak Research AI', type: 'website' },
};

// Every CitedEvidence module, in CitedEvidence's own words (its admin feature list, 2026-11-13),
// each linking to the module's public page there. The page is a funnel into CitedEvidence.
const MODULES = [
  { name: 'Deep Reasoning', text: 'Multiagent research with 200+ AI agents for source-aware academic work.', path: '/ai-research-assistant', action: 'Start deep research', icon: LuBrain },
  { name: 'Find Articles', text: 'Search 300M+ articles, journals, authors, and grounded research search strings.', path: '/research-paper-finder', action: 'Find articles', icon: LuSearch },
  { name: 'PDF Chat', text: 'Ask questions from PDFs and turn papers into usable evidence.', path: '/chat-with-pdf', action: 'Chat with PDFs', icon: LuFileText },
  { name: 'AI Editor', text: 'Rewrite, humanize, refine, and improve academic text in one editor.', path: '/ai-research-paper-writer', action: 'Open AI Editor', icon: LuFilePen },
  { name: 'Library', text: 'Organize papers, PDFs, notes, citations, and source material.', path: '/zotero-mendeley-integration', action: 'Open Library', icon: LuFolderOpen },
  { name: 'Research Notes', text: 'Capture notes, evidence, and source-linked ideas while you research.', path: '/notes', action: 'Start notes', icon: LuStickyNote },
  { name: 'Thesis to Manuscript', text: 'Convert thesis chapters into a journal-ready manuscript with tables, figures, and references preserved.', path: '/features/thesis-to-manuscript', action: 'Convert thesis', icon: LuFileOutput },
  { name: 'Proposal & Literature Studio', text: 'Multiagent proposal and literature writing with thousands of citation styles.', path: '/ai-literature-review', action: 'Use studio', icon: LuLayers },
  { name: 'Citation Generator', text: 'Generate citations and manage references for academic writing.', path: '/ai-citation-generator', action: 'Generate citations', icon: LuQuote },
  { name: 'Citation Checker', text: 'Check each reference against scholarly records: verified, wrong or not found.', path: '/ai-citation-checker', action: 'Check citations', icon: LuBadgeCheck },
  { name: 'AI Thesis', text: 'Generate proposals, thesis sections, and long-form academic documents.', path: '/ai-research-proposal-generator', action: 'Build thesis', icon: LuBookOpen },
  { name: 'Manuscript Reviewer', text: 'Review manuscripts for structure, clarity, journal fit, and readiness.', path: '/ai-peer-review', action: 'Review manuscript', icon: LuFileSearch },
  { name: 'Data Analysis', text: 'Analyze datasets, compare groups, and produce research-ready summaries.', path: '/ai-data-analysis', action: 'Analyze data', icon: LuChartColumn },
  { name: 'Systematic Review', text: 'Run structured evidence reviews with screening, extraction, and synthesis.', path: '/systematic-review-software', action: 'Start review', icon: LuListChecks },
  { name: 'AI Humanizer', text: 'Make AI-assisted writing sound more natural and academic.', path: '/ai-humanizer', action: 'Humanize text', icon: LuWandSparkles },
  { name: 'AI Detector', text: 'Review text for AI-likeness and writing quality signals.', path: '/ai-content-detector', action: 'Check text', icon: LuScanSearch },
  { name: 'Paraphraser', text: 'Rewrite text while preserving meaning and academic tone.', path: '/ai-paraphrasing-tool', action: 'Paraphrase text', icon: LuShuffle },
  { name: 'PDF Tools', text: 'Prepare, convert, secure, and work with research PDFs.', path: '/features/pdf-tools', action: 'Open PDF tools', icon: LuFiles },
  { name: 'Data Collection Tools', text: 'Create forms and collect structured research data.', path: '/features/data-collection', action: 'Build a form', icon: LuClipboardList },
];

const STATS = [['300M+', 'research articles'], ['200+', 'AI research agents'], ['1000s', 'citation styles'], ['1 login', 'for both platforms']];

const ARTICLES = [
  { title: 'Best Data Analysis Tools for PhD Students (2026)', topic: 'Research Tools', path: '/help/best-data-analysis-tools-for-phd-students-2026' },
  { title: 'How to Cite Sources in APA Format Correctly', topic: 'Academic Writing', path: '/help/how-to-cite-sources-in-apa-format-correctly-a-step-by-step-guide' },
  { title: 'Why Finding Relevant Research Papers is So Hard', topic: 'Literature Review', path: '/help/why-finding-relevant-research-papers-is-so-hard' },
  { title: 'AI Writing Assistants for Researchers Comparison', topic: 'Research Tools', path: '/help/ai-writing-assistants-for-researchers-comparison-2026-guide' },
  { title: 'How to Generate Citations Automatically', topic: 'Citations & References', path: '/help/how-to-generate-citations-automatically' },
  { title: 'Top Tools for Evidence-Based Research 2026', topic: 'Research Tools', path: '/help/top-tools-for-evidence-based-research-2026' },
];

const pill = 'inline-flex items-center justify-center rounded-full bg-[#0d6efd] px-5 py-2 text-[12px] font-medium uppercase text-white shadow-[0_2px_6px_rgba(13,110,253,.35)] transition-colors hover:bg-[#0b5ed7]';
const plain = 'inline-flex items-center justify-center rounded-lg bg-white px-6 py-2 text-[16px] text-[#1e1e2d] transition-colors hover:bg-[#f1f5f9]';

export default function ClassicHome() {
  return (
    <>
      {/* Main banner */}
      <section id="top" aria-labelledby="hero-title" className="relative flex min-h-[100svh] flex-col bg-white bg-cover bg-center" style={{ backgroundImage: "url('/classic/hero-bg.webp')" }}>
        <div className="mx-auto flex w-full max-w-[1140px] flex-1 flex-col items-center justify-center px-4 pb-24 pt-32 text-center">
          <p className="classic-rise mb-4 text-[14px] font-semibold text-black"><LuSparkles className="mr-1 inline size-4 align-[-2px]" aria-hidden="true" />Videmak Research AI is now CitedEvidence</p>
          <h1 id="hero-title" className="classic-rise text-[24px] font-normal text-[#1e1e2d] md:text-[32px]" style={{ animationDelay: '.1s' }}>Save hours of research with CitedEvidence AI</h1>
          <p className="classic-rise mx-auto mt-2 w-full max-w-[800px] text-[34px] leading-[1.25] md:text-[64px]" style={{ animationDelay: '.15s' }}>
            <RotatingHeadline phrases={['200M+ Citations By AI', '300M+ Research Articles', '200+ Deep Reasoning Agents']} />
          </p>
          <p className="classic-rise mt-2 text-[15px] font-bold text-black md:text-[16px]" style={{ animationDelay: '.4s' }}>
            The upgraded research, citation, PDF chat, literature review, and AI writing platform for serious academic work.
          </p>
          <div className="mt-6">
            <p className="pb-4 text-[17px] text-[#1e1e2d] md:text-[19px]">Videmak has evolved into CitedEvidence. Start your next research workflow there.</p>
            <a href={ceLink()} className="inline-block rounded-full bg-[#101828] px-10 py-3 text-[17px] font-bold text-white transition-transform hover:scale-105">Start Using CitedEvidence</a>
          </div>
        </div>
        <svg className="block h-[60px] w-full md:h-[105px]" preserveAspectRatio="none" viewBox="0 0 1440 105" aria-hidden="true">
          <path d="M0 0C240 68.7147 480 103.072 720 103.072C960 103.072 1200 68.7147 1440 0V104.113H0V0Z" fill="#f8fafc" />
        </svg>
      </section>

      {/* CitedEvidence */}
      <section id="citedevidence" aria-labelledby="ce-title" className="bg-[#f8fafc] pb-[72px] pt-[84px]">
        <div className="mx-auto max-w-[1140px] px-4">
          <div className="grid items-center gap-10 lg:grid-cols-[7fr_5fr]">
            <div>
              <p className="mb-2 text-[12px] font-extrabold uppercase tracking-[.08em] text-[#2563eb]">Videmak has evolved into CitedEvidence</p>
              <h2 id="ce-title" className="text-[30px] font-extrabold leading-[1.15] text-[#111827] md:text-[36px]">Move from searching to cited research output faster</h2>
              <p className="mt-4 text-[16px] leading-[1.8] text-[#4b5563]">CitedEvidence combines deep reasoning, article discovery, PDF chat, citation generation, literature review writing, notes, and library management in one research workspace. Existing Videmak users can still access saved documents here in read-only mode.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href={ceLink()} className={pill}>Start Using CitedEvidence</a>
                <Link href="/login" className={plain}>Access Videmak Archive</Link>
              </div>
            </div>
            <ul className="grid grid-cols-2 gap-4">
              {STATS.map(([value, label]) => (
                <li key={label} className="min-h-[118px] rounded-lg border border-[#e5e7eb] bg-white p-[22px]">
                  <p className="text-[26px] font-black leading-none text-[#111827] md:text-[30px]">{value}</p>
                  <p className="mt-3 text-[13px] font-bold text-[#64748b]">{label}</p>
                </li>
              ))}
            </ul>
          </div>
          <h3 className="mb-8 mt-16 max-w-[780px] text-[22px] font-extrabold leading-[1.25] text-[#111827] md:text-[26px]">Choose the CitedEvidence workflow that matches your academic journey</h3>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map(({ name, text, path, action, icon: Icon }) => (
              <li key={name} className="flex flex-col rounded-lg border border-[#e5e7eb] bg-white p-[18px] sm:min-h-[230px] sm:p-[22px]">
                <Icon className="mb-3 size-[22px] text-[#2563eb]" aria-hidden="true" />
                <h4 className="mb-2 text-[16px] font-bold text-[#111827]">{name}</h4>
                <p className="flex-1 text-[13px] leading-[1.6] text-[#64748b]">{text}</p>
                <a href={ceLink(path)} className={`${pill} mt-3 self-start px-4 py-1.5 text-[11px]`}>{action}</a>
              </li>
            ))}
          </ul>
          <div className="mt-12 flex flex-col gap-6 rounded-lg bg-[#111827] p-[34px] lg:flex-row lg:items-center">
            <div className="flex-1">
              <h3 className="mb-2 text-[22px] font-extrabold text-white md:text-[26px]">Still need old Videmak documents?</h3>
              <p className="leading-[1.7] text-[#cbd5e1]">Log in to Videmak for read-only access to saved documents and history. Create all new research projects in CitedEvidence.</p>
            </div>
            <Link href="/login" className={`${plain} self-start lg:self-auto`}>Open Videmak Archive</Link>
          </div>
        </div>
      </section>

      {/* CitedEvidence Help Center */}
      <section id="citedevidence-help" aria-labelledby="help-title" className="bg-white py-[78px]">
        <div className="mx-auto max-w-[1140px] px-4">
          <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end">
            <div className="flex-1">
              <p className="mb-2 text-[12px] font-extrabold uppercase tracking-[.08em] text-[#2563eb]">CitedEvidence Help Center</p>
              <h2 id="help-title" className="max-w-[760px] text-[28px] font-extrabold leading-[1.2] text-[#111827] md:text-[32px]">Research guides, citation tutorials, and AI workflow articles</h2>
            </div>
            <a href={ceLink('/help')} className={`${pill} self-start lg:self-auto`}>View All Articles</a>
          </div>
          <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {ARTICLES.map((article) => (
              <li key={article.path}>
                <a href={ceLink(article.path)} className="flex h-full flex-col rounded-lg border border-[#e5e7eb] bg-white p-6 text-[#111827] transition-shadow hover:shadow-[0_12px_30px_-18px_rgba(15,23,42,.35)]">
                  <span className="text-[12px] font-extrabold text-[#2563eb]">{article.topic}</span>
                  <span className="mb-4 mt-3 flex-1 text-[18px] font-extrabold leading-[1.35]">{article.title}</span>
                  <span className="text-[13px] font-extrabold text-[#2563eb]">Read guide <LuArrowRight className="ml-1 inline size-3.5" aria-hidden="true" /></span>
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-12 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] p-[30px] text-center">
            <h3 className="mb-2 text-[18px] font-bold text-[#111827]">Ready to turn sources into cited research?</h3>
            <p className="mb-4 text-[#475569]">Start in CitedEvidence, then use Videmak only when you need old read-only documents and history.</p>
            <a href={ceLink()} className={pill}>Start Using CitedEvidence</a>
          </div>
        </div>
      </section>
    </>
  );
}
