import { pageMetadata } from '@/components/marketing/seo';
import { container } from '@/components/marketing/styles';

export const metadata = pageMetadata({
  title: 'Citation styles',
  path: '/citation-styles',
  description: 'APA 7, MLA 9, Chicago, Harvard, IEEE, Vancouver, AMA and more: switch the citation style of a whole document in Videmak and every citation and reference updates.',
});

const STYLES: { name: string; kind: string; inText: string; field: string }[] = [
  { name: 'APA 7th', kind: 'Author–date', inText: '(Walker & Stickgold, 2005)', field: 'Psychology, education, social sciences' },
  { name: 'APA 6th', kind: 'Author–date', inText: '(Walker & Stickgold, 2005)', field: 'Older APA requirements' },
  { name: 'MLA 9th', kind: 'Author–page', inText: '(Walker and Stickgold)', field: 'Literature, languages, humanities' },
  { name: 'Chicago (Author-Date)', kind: 'Author–date', inText: '(Walker and Stickgold 2005)', field: 'Sciences and social sciences' },
  { name: 'Chicago (Notes)', kind: 'Notes', inText: 'Footnote', field: 'History, arts, humanities' },
  { name: 'Turabian', kind: 'Notes', inText: 'Footnote', field: 'Student papers in the humanities' },
  { name: 'Harvard', kind: 'Author–date', inText: '(Walker and Stickgold, 2005)', field: 'Many UK and Australian universities' },
  { name: 'IEEE', kind: 'Numbered', inText: '[1]', field: 'Engineering, computer science' },
  { name: 'Vancouver', kind: 'Numbered', inText: '(1)', field: 'Medicine, health sciences' },
  { name: 'AMA', kind: 'Numbered', inText: 'Superscript ¹', field: 'Medicine' },
  { name: 'Nature', kind: 'Numbered', inText: 'Superscript ¹', field: 'Natural sciences' },
  { name: 'Science', kind: 'Numbered', inText: '(1)', field: 'Natural sciences' },
  { name: 'OSCOLA', kind: 'Notes', inText: 'Footnote', field: 'Law (UK)' },
];

export default function CitationStylesPage() {
  return (
    <div className={container}>
      <div className="pb-6 pt-10 md:pt-[46px]">
        <h1 className="text-[34px] font-bold tracking-[-0.03em] text-ink sm:text-[42px]">Citation styles</h1>
        <p className="mt-2 max-w-[680px] text-[17px] text-ink-2">
          Choose a style in the editor&apos;s status bar and every citation and the reference list update. Search the style menu for journal and university variants (BMJ, The Lancet, PLOS, ACM, Springer, Elsevier and others).
        </p>
      </div>
      <div className="mb-20 overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[640px] border-collapse text-left text-[15px]">
          <thead>
            <tr className="bg-soft text-[13px] text-muted">
              <th scope="col" className="px-5 py-3 font-semibold">Style</th>
              <th scope="col" className="px-5 py-3 font-semibold">Type</th>
              <th scope="col" className="px-5 py-3 font-semibold">In the text</th>
              <th scope="col" className="px-5 py-3 font-semibold">Common in</th>
            </tr>
          </thead>
          <tbody>
            {STYLES.map((style) => (
              <tr key={style.name} className="border-t border-line-2">
                <th scope="row" className="px-5 py-3 font-semibold text-ink">{style.name}</th>
                <td className="px-5 py-3 text-ink-2">{style.kind}</td>
                <td className="px-5 py-3 font-serif text-ink-2">{style.inText}</td>
                <td className="px-5 py-3 text-ink-2">{style.field}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
