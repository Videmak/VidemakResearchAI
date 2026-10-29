/**
 * Product visuals for the landing page, drawn in HTML/CSS (no images, no client JS). They show
 * real Videmak behaviour: cited autocomplete, Find papers, chat with sources, review comments,
 * Word/LaTeX export and the phone editor. Decorative: each frame is labelled for screen readers.
 */
import type { ReactNode } from 'react';
import { LuArrowUp, LuCheck, LuFilePlus, LuFileText, LuSearch, LuSparkles, LuUpload, LuX } from 'react-icons/lu';

function Frame({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <figure
      aria-label={label}
      className={`relative overflow-hidden rounded-[16px] border border-line bg-white p-4 shadow-[0_18px_40px_-30px_rgba(15,23,42,.35)] sm:p-5 ${className}`}
    >
      <div aria-hidden="true">{children}</div>
    </figure>
  );
}

const cite = 'whitespace-nowrap text-brand';

export function AutocompleteVisual() {
  return (
    <Frame label="Autocomplete suggesting a sentence that already cites Diekelmann and Born, 2010">
      <p className="font-serif text-[14.5px] leading-[1.7] text-ink sm:text-[15.5px]">
        Sleep actively supports the stabilisation of new memories <span className={cite}>(Walker &amp; Stickgold, 2004)</span>.
        When sleep is restricted after learning, retention of declarative material declines
        <span className="text-slate-400"> measurably, even when study time is held constant </span>
        <span className="whitespace-nowrap text-blue-300">(Diekelmann &amp; Born, 2010)</span>
        <span className="text-slate-400">.</span>
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-ink px-3 text-[13px] font-semibold text-white shadow-[0_10px_24px_-12px_rgba(15,23,42,.6)]">
          Accept <kbd className="rounded-md bg-white/15 px-1.5 py-0.5 font-sans text-[12px]">Tab</kbd>
          <span className="text-white/50">·</span> Refine
        </span>
        <span className="text-[12.5px] text-muted">Suggestion with a real reference</span>
      </div>
      <div className="mt-4 rounded-[14px] border border-line bg-soft p-3.5 sm:ml-10">
        <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
          <span className="rounded-md bg-green-100 px-2 py-0.5 text-green-800">Open access</span>
          <span className="rounded-md bg-brand-50 px-2 py-0.5 text-brand-600">Highly cited</span>
        </div>
        <p className="mt-2 text-[14px] font-bold text-ink">The memory function of sleep</p>
        <p className="mt-0.5 text-[12.5px] text-muted">Diekelmann S, Born J · Nat Rev Neurosci · 2010</p>
      </div>
    </Frame>
  );
}

const PAPERS = [
  { title: 'About sleep’s role in memory', meta: 'Rasch B, Born J · Physiol Rev · 2013', tags: ['Review', 'Open access'] },
  { title: 'Sleep-dependent memory consolidation', meta: 'Stickgold R · Nature · 2005', tags: ['Highly cited'] },
];
const STYLES = ['APA 7', 'MLA 9', 'Chicago', 'Harvard', 'IEEE', 'Vancouver'];

export function FindPapersVisual() {
  return (
    <Frame label="Find papers: search results with Cite buttons, and citation styles">
      <div className="flex h-10 items-center gap-2 rounded-[11px] border border-line bg-white px-3 text-[14px] text-ink shadow-[0_1px_2px_rgba(15,23,42,.05)]">
        <LuSearch className="h-4 w-4 shrink-0 text-subtle" />
        <span className="truncate">sleep and memory consolidation</span>
      </div>
      <p className="mt-2.5 text-[12px] text-muted">91,604 results · Most relevant</p>
      <ul className="mt-2 flex flex-col gap-2.5">
        {PAPERS.map((paper) => (
          <li key={paper.title} className="flex items-start gap-3 rounded-[14px] border border-line p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                {paper.tags.map((tag) => (
                  <span key={tag} className={`rounded-md px-2 py-0.5 ${tag === 'Open access' ? 'bg-green-100 text-green-800' : tag === 'Highly cited' ? 'bg-brand-50 text-brand-600' : 'bg-line-2 text-ink-2'}`}>{tag}</span>
                ))}
              </div>
              <p className="mt-1.5 truncate text-[14px] font-bold text-ink">{paper.title}</p>
              <p className="truncate text-[12.5px] text-muted">{paper.meta}</p>
            </div>
            <span className="shrink-0 rounded-[9px] bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white">Cite</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {STYLES.map((style, index) => (
          <span key={style} className={`rounded-full border px-2.5 py-1 text-[12px] font-medium ${index === 0 ? 'border-brand-100 bg-brand-50 text-brand-600' : 'border-line text-ink-2'}`}>{style}</span>
        ))}
        <span className="rounded-full px-1 py-1 text-[12px] text-muted">+10,000 more</span>
      </div>
    </Frame>
  );
}

export function ChatVisual() {
  return (
    <Frame label="AI Chat answering from uploaded PDFs, with the page each answer came from">
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-[16px] rounded-br-[6px] bg-brand px-3.5 py-2.5 text-[14px] leading-snug text-white">
          What do my PDFs say about slow-wave sleep?
        </p>
      </div>
      <p className="mt-4 text-[14px] leading-[1.6] text-ink-2">
        Two of your papers link slow-wave sleep to the replay of hippocampal memory traces
        <sup className="ml-0.5 rounded bg-brand-50 px-1 text-[10.5px] font-bold text-brand-600">1</sup>, which predicts next-day recall
        <sup className="ml-0.5 rounded bg-brand-50 px-1 text-[10.5px] font-bold text-brand-600">2</sup>.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {[
          ['1', 'Rasch & Born (2013)', 'p. 4'],
          ['2', 'Marshall et al. (2006)', 'p. 611'],
        ].map(([n, source, page]) => (
          <li key={n} className="flex items-center gap-2.5 rounded-[12px] border border-line px-3 py-2 text-[13px]">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-brand-50 text-[11px] font-bold text-brand-600">{n}</span>
            <LuFileText className="h-4 w-4 shrink-0 text-subtle" />
            <span className="min-w-0 flex-1 truncate font-medium text-ink">{source}</span>
            <span className="shrink-0 text-muted">{page}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-2 rounded-[14px] border border-line px-3 py-2 text-[13.5px] text-subtle">
        <span className="flex-1 truncate">Ask about your papers…</span>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-white"><LuArrowUp className="h-4 w-4" /></span>
      </div>
    </Frame>
  );
}

const COMMENTS = [
  { tone: 'Major', color: 'bg-red-50 text-red-700', text: 'This claim needs a citation: no source supports “most students”.' },
  { tone: 'Minor', color: 'bg-amber-50 text-amber-800', text: 'Long sentence. Split it so the finding comes first.' },
];

export function ReviewVisual() {
  return (
    <Frame label="AI review: Major and Minor comments on a draft">
      <p className="font-serif text-[14.5px] leading-[1.7] text-ink sm:text-[15.5px]">
        <span className="rounded bg-red-100/70 px-0.5">Most students sleep less than six hours before exams</span>, and this
        affects <span className="rounded bg-amber-100/80 px-0.5">performance in ways that are complex and that depend on many factors.</span>
      </p>
      <ul className="mt-4 flex flex-col gap-2.5">
        {COMMENTS.map((comment) => (
          <li key={comment.tone} className="rounded-[14px] border border-line p-3">
            <div className="flex items-center gap-2">
              <span className={`rounded-md px-2 py-0.5 text-[11.5px] font-bold ${comment.color}`}>{comment.tone}</span>
              <span className="text-[12px] text-muted">AI review</span>
              <span className="ml-auto text-[12px] font-semibold text-brand">Fix</span>
            </div>
            <p className="mt-1.5 text-[13.5px] leading-snug text-ink-2">{comment.text}</p>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

const TEMPLATES = ['Blank', 'Literature review', 'Research proposal', 'Essay'];

export function ImportVisual() {
  return (
    <Frame label="Start from a template or open a Word file; its styles, comments and tracked changes come with it">
      <div className="flex flex-wrap gap-2">
        {TEMPLATES.map((name, index) => (
          <span key={name} className={`inline-flex h-8 items-center gap-1.5 rounded-[9px] border px-2.5 text-[12.5px] font-medium ${index === 0 ? 'border-brand-100 bg-brand-50 text-brand-600' : 'border-line text-ink-2'}`}>
            {index === 0 && <LuFilePlus className="h-3.5 w-3.5" />}{name}
          </span>
        ))}
      </div>
      <div className="mt-4 flex flex-col items-center rounded-[14px] border-2 border-dashed border-line bg-soft px-4 py-5 text-center">
        <LuUpload className="h-5 w-5 text-brand" />
        <p className="mt-2 text-[13.5px] font-semibold text-ink">Open a Word file</p>
        <p className="text-[12px] text-muted">.docx, .doc, .odt or .rtf</p>
      </div>
      <div className="mt-3 flex items-center gap-3 rounded-[14px] border border-line p-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[#2b579a] text-[11px] font-bold text-white">DOCX</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-ink">Thesis-chapter-2.docx</p>
          <p className="text-[12.5px] text-muted">Styles, comments and tracked changes kept</p>
        </div>
        <LuCheck className="h-4 w-4 shrink-0 text-green-600" />
      </div>
    </Frame>
  );
}

const FILES = [
  { ext: 'DOCX', name: 'Thesis-chapter-2.docx', color: 'bg-[#2b579a]' },
  { ext: 'PDF', name: 'Thesis-chapter-2.pdf', color: 'bg-[#dc2626]' },
  { ext: 'TEX', name: 'Thesis-chapter-2.tex', color: 'bg-[#0f766e]' },
];

export function ExportVisual() {
  return (
    <Frame label="Export to Word, PDF and LaTeX with the reference list built">
      <div className="flex flex-col gap-2.5">
        {FILES.map((file) => (
          <div key={file.ext} className="flex items-center gap-3 rounded-[14px] border border-line p-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-[11px] font-bold text-white ${file.color}`}>{file.ext}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-ink">{file.name}</p>
              <p className="text-[12.5px] text-muted">Styles, headings and references kept</p>
            </div>
            <span className="hidden shrink-0 rounded-[9px] border border-line px-2.5 py-1 text-[12.5px] font-semibold text-ink sm:inline">Download</span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-[14px] bg-soft p-3.5">
        <p className="text-[12px] font-semibold uppercase tracking-[.08em] text-muted">References</p>
        <p className="mt-1.5 font-serif text-[13.5px] leading-[1.6] text-ink-2">
          Diekelmann, S., &amp; Born, J. (2010). The memory function of sleep. <i>Nature Reviews Neuroscience, 11</i>(2), 114–126.
        </p>
      </div>
    </Frame>
  );
}

export function PhoneVisual() {
  return (
    <div className="flex justify-center" role="img" aria-label="The Videmak editor on a phone">
      <div aria-hidden="true" className="w-[240px] rounded-[36px] border border-line bg-ink p-2.5 shadow-[0_30px_60px_-30px_rgba(15,23,42,.5)]">
        <div className="overflow-hidden rounded-[30px] bg-white">
          <div className="flex items-center justify-between px-5 pt-3 text-[11px] font-semibold text-ink">
            <span>9:41</span>
            <span className="h-4 w-16 rounded-full bg-ink" />
            <span>100%</span>
          </div>
          <div className="flex items-center gap-2 border-b border-line-2 px-4 py-3">
            <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">Thesis — Chapter 2</span>
            <span className="rounded-full bg-brand px-2 py-0.5 text-[10.5px] font-bold text-white">Saved</span>
          </div>
          <div className="px-4 py-3">
            <p className="font-serif text-[17px] font-bold leading-tight text-ink">2.1 Sleep and learning</p>
            <p className="mt-2 font-serif text-[12.5px] leading-[1.7] text-ink-2">
              Restricted sleep reduces recall of declarative material <span className="text-brand">(Diekelmann &amp; Born, 2010)</span>
              <span className="text-slate-400"> and slows the transfer of memories to the cortex</span>
            </p>
            <span className="mt-2 inline-flex items-center gap-1 rounded-lg bg-ink px-2 py-1 text-[10.5px] font-semibold text-white">
              <LuSparkles className="h-3 w-3" /> Accept
            </span>
          </div>
          <div className="mt-6 grid grid-cols-5 items-end border-t border-line-2 px-2 pb-3 pt-2 text-center text-[9.5px] font-semibold text-subtle">
            <span className="text-brand">Docs</span><span>Library</span>
            <span className="mx-auto grid h-8 w-8 place-items-center rounded-[10px] bg-brand text-[16px] text-white">+</span>
            <span>Papers</span><span>Chat</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Not another chatbot": what Videmak does that a general AI chat does not. */
export const COMPARISON_ROWS: { label: string; videmak: string; chatbot: string }[] = [
  { label: 'References', videmak: 'Real papers you can open', chatbot: 'Can be made up' },
  { label: 'Where you write', videmak: 'In your document', chatbot: 'Copy and paste' },
  { label: 'Citation style', videmak: 'APA, MLA and 10,000+ more', chatbot: 'Formatted by hand' },
  { label: 'Your PDFs', videmak: 'Answers with page numbers', chatbot: 'No page references' },
  { label: 'Word and LaTeX', videmak: 'Export with the reference list', chatbot: 'Not available' },
];

export function CloseMark() {
  return <LuX className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />;
}
