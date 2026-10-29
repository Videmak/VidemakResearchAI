/**
 * Starting points on the documents page: a title and the usual sections, with a one-line
 * hint under each heading. They are ordinary blocks; nothing about them is special later.
 */
export type DocumentTemplate = {
  id: 'literature-review' | 'research-proposal' | 'essay';
  name: string;
  shortName: string;
  description: string;
  /** Two or three words under the short name, where space is tight. */
  tagline: string;
  title: string;
  sections: { heading: string; hint: string }[];
};

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'literature-review',
    name: 'Literature review',
    shortName: 'Lit review',
    description: 'Themes, gaps and a reference list',
    tagline: 'Themes and gaps',
    title: 'Literature review',
    sections: [
      { heading: 'Introduction', hint: 'State the question, why it matters and the scope of the review.' },
      { heading: 'Search strategy', hint: 'Databases, search terms, dates and inclusion criteria.' },
      { heading: 'Theme 1', hint: 'What the studies agree on, where they differ, and how strong the evidence is.' },
      { heading: 'Theme 2', hint: 'Group the next set of findings; cite as you go with @.' },
      { heading: 'Gaps in the literature', hint: 'What is still unknown, and which methods could answer it.' },
      { heading: 'Conclusion', hint: 'Summarise the main findings and what they mean for your work.' },
      { heading: 'References', hint: 'Citations you add with @ appear here in your chosen style.' },
    ],
  },
  {
    id: 'research-proposal',
    name: 'Research proposal',
    shortName: 'Proposal',
    description: 'Aims, methods, timeline, budget',
    tagline: 'Aims and methods',
    title: 'Research proposal',
    sections: [
      { heading: 'Background', hint: 'The problem, what is already known and the gap your study fills.' },
      { heading: 'Aims', hint: 'Two or three specific, testable aims.' },
      { heading: 'Methods', hint: 'Design, participants, measures and analysis for each aim.' },
      { heading: 'Timeline', hint: 'Milestones by month or quarter.' },
      { heading: 'Budget', hint: 'Staff, equipment, travel and other costs, with a short justification.' },
      { heading: 'References', hint: 'Citations you add with @ appear here in your chosen style.' },
    ],
  },
  {
    id: 'essay',
    name: 'Essay',
    shortName: 'Essay',
    description: 'Argument, evidence and citations',
    tagline: 'Argument',
    title: 'Essay',
    sections: [
      { heading: 'Introduction', hint: 'Open with the question and state your argument in one sentence.' },
      { heading: 'Argument', hint: 'Your main points, one paragraph each.' },
      { heading: 'Evidence', hint: 'Studies and data that support each point; cite them with @.' },
      { heading: 'Counterarguments', hint: 'The strongest objection, and your answer to it.' },
      { heading: 'Conclusion', hint: 'What follows from the argument, and why it matters.' },
      { heading: 'References', hint: 'Citations you add with @ appear here in your chosen style.' },
    ],
  },
];

export function findTemplate(id: string | null | undefined): DocumentTemplate | null {
  return DOCUMENT_TEMPLATES.find((template) => template.id === id) ?? null;
}

/** BlockNote blocks for a template: the title, then each section heading and its hint. */
export function templateBlocks(template: DocumentTemplate): any[] {
  const text = (value: string, styles: Record<string, boolean | string> = {}) => [{ type: 'text', text: value, styles }];
  return [
    { type: 'heading', props: { level: 1 }, content: text(template.title) },
    ...template.sections.flatMap((section) => [
      { type: 'heading', props: { level: 2 }, content: text(section.heading) },
      { type: 'paragraph', content: text(section.hint, { textColor: 'gray' }) },
    ]),
  ];
}

/** Session key that carries the chosen template from the documents page to the new document. */
export const PENDING_TEMPLATE_KEY = 'videmak-pending-template';
