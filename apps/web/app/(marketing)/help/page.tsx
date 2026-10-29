import Link from 'next/link';
import { pageMetadata } from '@/components/marketing/seo';
import { container, focusRing } from '@/components/marketing/styles';

export const metadata = pageMetadata({
  title: 'Help center',
  path: '/help',
  description: 'How to write, cite, review and export with Videmak: autocomplete, citations, Library, AI Chat, review checks, Word/PDF/LaTeX export and shortcuts.',
});

type Topic = { id: string; title: string; items: [string, React.ReactNode][] };

const kbd = (keys: string) => <kbd className="rounded-md border border-b-2 border-line bg-white px-1.5 py-px font-sans text-[12.5px] text-ink-2">{keys}</kbd>;

const TOPICS: Topic[] = [
  {
    id: 'start',
    title: 'Getting started',
    items: [
      ['New document', <>Start blank, from a template (literature review, research proposal, essay) or open a Word file. Formatting, comments and tracked changes come with it.</>],
      ['Saving', <>Everything saves as you type. File › Version history shows earlier versions; name one or restore it.</>],
      ['Sharing', <>Share invites people by email as editors, commenters or viewers, or turns on a link.</>],
    ],
  },
  {
    id: 'ai',
    title: 'Writing with AI',
    items: [
      ['Autocomplete', <>Turn it on in the toolbar. Pause at the end of a paragraph and grey text appears with sources. {kbd('Tab')} accepts, Refine asks again, Conclude writes a closing sentence and the next heading.</>],
      ['AI suggest and Cite', <>The small bar at the cursor writes from exactly there, or opens citation search.</>],
      ['Autocomplete sources', <>The arrow next to Autocomplete: web or Library papers, a folder of your Library, publication years, citation counts, preprints.</>],
      ['Write with AI', <>In the side rail or the AI menu. Give a topic and choose papers, your Library or both; it drafts the document section by section with citations, and you accept each part.</>],
      ['A paragraph', <>Hover a paragraph and use ✦: edit with AI, find citations for it, ask about it, review or comment.</>],
    ],
  },
  {
    id: 'cite',
    title: 'Citations and references',
    items: [
      ['Cite', <>Type {kbd('@')} or use Cite in the toolbar, then search your Library and published papers. The reference list builds itself under References.</>],
      ['Style', <>Pick the style in the status bar (APA, MLA, Chicago, Harvard, IEEE, Vancouver and more); every citation and reference updates. <Link href="/citation-styles" className="text-brand underline-offset-4 hover:underline">All styles</Link></>],
      ['A citation', <>Click it to open the paper, save it to your Library, switch to Author (Year) or edit it.</>],
    ],
  },
  {
    id: 'library',
    title: 'Library, Find papers and AI Chat',
    items: [
      ['Library', <>Upload PDFs and keep them in collections. Cite them, or Ask to chat about one.</>],
      ['Find papers', <>Search scholarly papers with year, citation and open-access filters. Cite into your document or save to your Library.</>],
      ['AI Chat', <>Answers cite real papers. Choose Web, Library and Document as sources, and add context with @.</>],
    ],
  },
  {
    id: 'review',
    title: 'Review',
    items: [
      ['Checks', <>Claim check, peer review, source quality, proofread and tone, on the whole document or a selection.</>],
      ['Changes', <>Proofread and claim fixes can be shown as tracked changes in the text. Accept or reject them one by one or all at once.</>],
      ['Comments', <>Select text and add a comment ({kbd('Ctrl+Alt+M')}). Reply, resolve or delete in the Comments panel.</>],
    ],
  },
  {
    id: 'export',
    title: 'Export',
    items: [
      ['Word', <>File › Download Word gives a .docx for Microsoft Word with headings, footnotes, comments, tracked changes, equations, tables and images.</>],
      ['PDF', <>File › Download PDF. Page size, margins, running head and page numbers come from File › Page setup.</>],
      ['LaTeX', <>File › Download LaTeX gives a zip for Overleaf: main.tex, references.bib and figures.</>],
    ],
  },
];

const SHORTCUTS: [string, string][] = [
  ['Bold, italic, underline', 'Ctrl+B · Ctrl+I · Ctrl+U'],
  ['Strikethrough', 'Alt+Shift+5'],
  ['Undo, redo', 'Ctrl+Z · Ctrl+Y'],
  ['Find, find and replace', 'Ctrl+F · Ctrl+H'],
  ['Insert link', 'Ctrl+K'],
  ['Comment', 'Ctrl+Alt+M'],
  ['Footnote', 'Ctrl+Alt+F'],
  ['Table', 'Ctrl+Alt+T'],
  ['Page break', 'Ctrl+Enter'],
  ['Headings 1–3', 'Ctrl+Alt+1 … 3'],
  ['Align left, centre, right, justify', 'Ctrl+Shift+L · E · R · J'],
  ['Bigger, smaller text', 'Ctrl+Shift+. · Ctrl+Shift+,'],
  ['Clear formatting', 'Ctrl+\\'],
  ['Word count', 'Ctrl+Shift+C'],
  ['Search menus', 'Alt+/'],
  ['All shortcuts', 'Ctrl+/'],
];

export default function HelpPage() {
  return (
    <div className={container}>
      <div className="pb-6 pt-10 md:pt-[46px]">
        <h1 className="text-[34px] font-bold tracking-[-0.03em] text-ink sm:text-[42px]">Help center</h1>
        <p className="mt-2 text-[17px] text-ink-2">How to write, cite, review and export with Videmak.</p>
      </div>
      <div className="grid gap-10 pb-20 md:grid-cols-[200px_minmax(0,1fr)] md:gap-14">
        <nav aria-label="Topics" className="hidden md:block">
          <ul className="sticky top-24 space-y-1 text-[14.5px]">
            {[...TOPICS, { id: 'shortcuts', title: 'Keyboard shortcuts' }].map((topic) => (
              <li key={topic.id}>
                <a href={`#${topic.id}`} className={`block rounded-lg px-2.5 py-1.5 text-ink-2 hover:bg-soft hover:text-ink ${focusRing}`}>{topic.title}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="space-y-12">
          {TOPICS.map((topic) => (
            <section key={topic.id} id={topic.id} aria-labelledby={`${topic.id}-title`} className="scroll-mt-24">
              <h2 id={`${topic.id}-title`} className="mb-4 text-[24px] font-bold tracking-[-0.02em] text-ink">{topic.title}</h2>
              <dl className="divide-y divide-line-2 rounded-2xl border border-line">
                {topic.items.map(([term, detail]) => (
                  <div key={term} className="grid gap-1 px-5 py-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-6">
                    <dt className="text-[15px] font-semibold text-ink">{term}</dt>
                    <dd className="text-[15px] leading-relaxed text-ink-2">{detail}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <section id="shortcuts" aria-labelledby="shortcuts-title" className="scroll-mt-24">
            <h2 id="shortcuts-title" className="mb-4 text-[24px] font-bold tracking-[-0.02em] text-ink">Keyboard shortcuts</h2>
            <p className="mb-3 text-[14px] text-muted">On a Mac, use ⌘ for Ctrl and ⌥ for Alt.</p>
            <dl className="grid gap-x-8 rounded-2xl border border-line px-5 py-2 sm:grid-cols-2">
              {SHORTCUTS.map(([action, keys]) => (
                <div key={action} className="flex items-center justify-between gap-4 border-b border-line-2 py-2.5 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
                  <dt className="text-[14.5px] text-ink-2">{action}</dt>
                  <dd className="shrink-0 text-right">{kbd(keys)}</dd>
                </div>
              ))}
            </dl>
          </section>
          <p className="text-[13px] text-muted">
            Videmak is open source under the MIT licence. Citation formatting powered by{' '}
            <a href="https://github.com/Juris-M/citeproc-js" className="underline hover:text-ink">citeproc-js</a>; other credits are in the NOTICE file.
          </p>
        </div>
      </div>
    </div>
  );
}
