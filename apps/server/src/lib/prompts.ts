/**
 * Every prompt the editor's AI uses, in one place: the assistant, block review and the
 * writing flow. The wording is deliberate and tested; change it with care.
 *
 * Sources are given to the model as a numbered list and cited as [S1]; the editor turns
 * those markers into real citations. Citations already in the writer's text arrive as
 * [[CITATION_n]] placeholders and must come back unchanged.
 */

export const AI_NAME = 'Videmak AI';

const CITE_RULES =
  'Sources are numbered S1, S2, ... Cite a source only where it directly supports the sentence, ' +
  'by writing its marker in square brackets right after the claim, e.g. [S2] or [S1, S3]. ' +
  'Never invent sources, authors, years or markers. Ignore sources that are not relevant, ' +
  'without mentioning them or the source list.';

export const SOURCE_MARKER_RULES = CITE_RULES + ' Keep every [[CITATION_n]] placeholder exactly as written and in place.';

/** Assistant prompts: answer in the writer's language when it is not English. */
export function languageRule(language?: string | null): string {
  return language && language !== 'en' ? ` Write in the language with code '${language}'.` : '';
}

const LANGUAGE_NAMES: Record<string, string> = {
  es: 'Spanish (Español)',
  ar: 'Arabic (العربية)',
  fr: 'French (Français)',
};

/** Writing-flow prompts (title, paragraph ...): the app's supported interface languages. */
export function languageInstruction(locale?: string | null): string {
  const name = locale ? LANGUAGE_NAMES[locale] : undefined;
  return name ? `\n\nIMPORTANT: You MUST respond in ${name}. All your output should be in ${name}.` : '';
}

// ------------------------------------------------------------------ sources

export type PromptSource = {
  marker: string;
  authors: string[];
  year: number | string | null;
  title: string;
  venue?: string | null;
  abstract?: string | null;
  evidence?: string[];
};

export function sourcesPrompt(sources: PromptSource[]): string {
  if (!sources.length) return 'No sources were found. Do not add citations.';
  return sources
    .map((source) => {
      const authors = source.authors.slice(0, 3).join(', ') + (source.authors.length > 3 ? ' et al.' : '');
      const text = (source.evidence || []).join(' ') || source.abstract || '';
      return `[${source.marker}] ${authors} (${source.year || 'n.d.'}). ${source.title}. ${source.venue || ''}\n    ${text}`;
    })
    .join('\n');
}

// ------------------------------------------------------------------ find citations for a passage

export function papersForTextPrompt(text: string, documentTitle?: string | null): string {
  return (
    'Write two short academic search queries (English, 3-7 words each) that would find ' +
    'peer-reviewed papers supporting the claims in this passage.\n' +
    `Document title: ${documentTitle || 'unknown'}\nPassage: ${text.slice(0, 3000)}\n` +
    'Return JSON only: ["query one", "query two"]'
  );
}

// ------------------------------------------------------------------ AI Edit

export function editSystemPrompt(language?: string | null): string {
  return (
    "You edit a passage of the writer's academic document following their instruction. " +
    'Return ONLY the edited passage as plain text (no preamble, no quotes, no markdown headings). ' +
    "Keep the writer's meaning and voice unless the instruction asks otherwise; keep paragraph breaks " +
    'as blank lines. ' + SOURCE_MARKER_RULES + languageRule(language)
  );
}

export function editUserPrompt(input: { documentTitle?: string | null; before?: string | null; after?: string | null; sources: string; instruction: string; text: string }): string {
  return (
    `Document title: ${input.documentTitle || 'Untitled'}\n` +
    `Text before the passage: ${(input.before || '').slice(-1500)}\n` +
    `Text after the passage: ${(input.after || '').slice(0, 800)}\n\n` +
    `SOURCES:\n${input.sources}\n\n` +
    `INSTRUCTION: ${input.instruction}\n\nPASSAGE:\n${input.text}`
  );
}

// ------------------------------------------------------------------ autocomplete

/** `hasPlaceholders`: the writer's text contains [[CITATION_n]]; without any, naming them makes models copy one. */
export function completeSystemPrompt(language?: string | null, hasPlaceholders = true, length: 'sentence' | 'paragraph' = 'sentence'): string {
  const amount = length === 'paragraph'
    ? 'the next two or three sentences (at most 90 words in all)'
    : 'ONE next sentence (at most 35 words)';
  return (
    `You continue the writer's academic text. Write ${amount} that follow ` +
    'naturally from where the text stops, in the same voice and tense. If the text stops mid-sentence, ' +
    'finish that sentence first. If text follows the cursor, write only what goes before it, never repeat ' +
    'it, and end so that it still reads on. Output only ' +
    'the continuation, with a leading space if it starts a new sentence. ' +
    (hasPlaceholders ? SOURCE_MARKER_RULES : CITE_RULES) + languageRule(language)
  );
}

/** Conclude: close the current section, name the next one, and title an untitled document. */
export function concludeSystemPrompt(language?: string | null, hasPlaceholders = true): string {
  return (
    "You help the writer finish the current section of their academic text. Write one or two sentences that " +
    'conclude this section, continuing from where the text stops (a leading space if it starts a new ' +
    'sentence), drawing its points together without new claims. Then give the heading of the NEXT section ' +
    'the document needs (in an academic paper, e.g. Background, Methods, Results, Discussion, Conclusion, in ' +
    'whatever order fits what is already written), in the same style as the existing headings (short, no ' +
    'trailing period; numbered only if the outline numbers its headings). Never repeat a heading in the ' +
    'outline. Leave it empty only if the current section is itself the final conclusion of the whole ' +
    'document. If the document title is missing or "Untitled", give a fitting title. ' +
    (hasPlaceholders ? SOURCE_MARKER_RULES : CITE_RULES) +
    ' Return JSON only: {"text": "...", "final_section": false, "next_heading": "...", "title": "..."}, where ' +
    'final_section is true only when this section closes the whole document.' + languageRule(language)
  );
}

export function completeUserPrompt(input: { documentTitle?: string | null; sectionTitle?: string | null; sources: string; refine?: string | null; before: string; after?: string | null; outline?: string[] }): string {
  return (
    `Document title: ${input.documentTitle || 'Untitled'}\nSection: ${input.sectionTitle || ''}\n` +
    (input.outline?.length ? `Outline (headings in order):\n${input.outline.map((heading) => `- ${heading}`).join('\n')}\n` : '') +
    '\n' +
    `SOURCES:\n${input.sources}\n\n` +
    (input.refine ? `The writer rejected the last suggestion: "${input.refine}". Suggest something different.\n\n` : '') +
    `TEXT SO FAR:\n${input.before.slice(-3000)}` +
    (input.after ? `\n\n(Text after the cursor: ${input.after.slice(0, 300)})` : '')
  );
}

// ------------------------------------------------------------------ review comments (assistant panel)

export const REVIEW_CATEGORIES = ['argument', 'evidence', 'citation', 'clarity', 'structure', 'style', 'grammar'] as const;

export function reviewCommentsSystemPrompt(language?: string | null): string {
  return (
    'You are a demanding but kind academic supervisor reviewing a draft. Comment like a reviewer in the ' +
    'margin: point out unsupported claims that need citations, weak arguments, unclear or overlong sentences, ' +
    'structure problems, and real grammar errors. Skip trivial nitpicks. Each comment must quote the exact ' +
    'words it is about (copied character for character from ONE block, at most 25 words) and give a concrete ' +
    'fix. Severity is "major" for problems that affect the argument, evidence or correctness, otherwise ' +
    '"minor". Category is one of: argument, evidence, citation, clarity, structure, style, grammar. ' +
    'Add "suggestion" (replacement text for the quote) only for clarity, style and grammar comments. ' +
    'Never quote or change [[CITATION_n]] placeholders. Return JSON only: ' +
    '[{"block_id": "...", "quote": "...", "comment": "...", "severity": "minor|major", ' +
    '"category": "...", "suggestion": "..."}]' + languageRule(language)
  );
}

export function reviewCommentsUserPrompt(input: { documentTitle?: string | null; focus?: string | null; perChunk: number; blocks: { id: string; text: string; heading?: boolean }[] }): string {
  const listing = input.blocks.map((block) => `<block id="${block.id}"${block.heading ? ' heading' : ''}>\n${block.text}\n</block>`).join('\n\n');
  return (
    `Document title: ${input.documentTitle || 'Untitled'}\n` +
    (input.focus ? `The writer asks you to focus on: ${input.focus}\n` : '') +
    `Give at most ${input.perChunk} comments, the most valuable first.\n\n${listing}`
  );
}

// ------------------------------------------------------------------ Review checks (the editor's Review panel)

const COMMENT_JSON =
  'Each item must quote the exact words it is about (copied character for character from ONE block, at most ' +
  '25 words). Never quote or change [[CITATION_n]] placeholders. Return JSON only: ' +
  '[{"block_id": "...", "quote": "...", "comment": "...", "severity": "minor|major", "category": "...", "suggestion": "..."}]';

export const CLAIM_CATEGORIES = ['unsupported', 'weakly_supported', 'overstated', 'unverifiable', 'contradicted', 'misrepresented'] as const;

/** Claim check: every claim that a careful examiner would question, sorted into one verdict each. */
export function claimCheckSystemPrompt(language?: string | null): string {
  return (
    'You check the claims in an academic draft the way a careful examiner would. Flag only claims that need ' +
    'attention and give each ONE category: "unsupported" (a factual or empirical claim with no citation), ' +
    '"weakly_supported" (cited, but the wording asks more of the evidence than one citation can carry), ' +
    '"overstated" (stronger than evidence allows, e.g. proves, always, clearly, all), "unverifiable" (too vague ' +
    'to check: no numbers, place, time or source), "contradicted" (conflicts with another statement in the ' +
    'draft), "misrepresented" (the claim next to a [[CITATION_n]] is unlikely to be what such a source says). ' +
    'The comment says in one or two sentences why, and what to do (cite, hedge, add specifics). Add ' +
    '"suggestion" (a replacement for the quote) only for overstated and unverifiable claims. Severity is ' +
    '"major" for unsupported, contradicted and misrepresented, otherwise "minor". Do not flag the writer\'s ' +
    'own aims, definitions or opinions that are marked as such. ' + COMMENT_JSON + languageRule(language)
  );
}

export const PROOFREAD_CATEGORIES = ['grammar', 'punctuation', 'word_choice', 'formality', 'passive_voice', 'repetition', 'formatting'] as const;

/** Proofread: small, exact corrections, each with its replacement text. */
export function proofreadSystemPrompt(language?: string | null): string {
  return (
    'You proofread an academic draft. Find real errors and clear improvements, each with ONE category: ' +
    '"grammar", "punctuation", "word_choice" (imprecise or wrong word), "formality" (too casual for academic ' +
    'writing), "passive_voice" (only where the active voice is clearly better), "repetition" (the same word or ' +
    'idea repeated close together), "formatting" (inconsistent capitals, numbers, units, abbreviations or ' +
    'spacing). Every item MUST have "suggestion": the corrected replacement for the quote, changing nothing ' +
    'else. The comment names the problem in a few words. Severity is "major" only when the error changes or ' +
    'obscures the meaning. Skip matters of taste. ' + COMMENT_JSON + languageRule(language)
  );
}

/** Tone of voice: sentences that don't match the tone the writer chose, rewritten to match. */
export function toneSystemPrompt(tone: string, language?: string | null): string {
  return (
    `You adjust the tone of an academic draft to this target: ${tone}. Find sentences whose tone does not match ` +
    'and rewrite them to match, keeping the meaning, facts and citations. Category is always "tone". Every item ' +
    'MUST have "suggestion": the rewritten replacement for the quote. The comment says in a few words what ' +
    'changes. Severity is "minor". ' + COMMENT_JSON + languageRule(language)
  );
}

/** Peer review: a referee report on the whole manuscript, in Markdown with fixed sections. */
export function peerReviewSystemPrompt(language?: string | null): string {
  return (
    'You are an experienced peer reviewer for a reputable journal in the manuscript\'s field. Write a fair, ' +
    'specific referee report in Markdown with exactly these sections: "## Summary" (3-4 sentences on what the ' +
    'work claims and does), "## Strengths" (bullets), "## Major issues" (numbered; each says what is wrong, ' +
    'why it matters and how to fix it), "## Minor issues" (bullets), "## Questions for the authors" (bullets) ' +
    'and a last line "Recommendation: Accept | Minor revision | Major revision | Reject". Quote short phrases ' +
    'from the manuscript to point at problems. Judge methods, evidence, argument, citations and clarity. Do ' +
    'not invent results or references.' + languageRule(language)
  );
}

export function peerReviewUserPrompt(input: { documentTitle?: string | null; field?: string | null; text: string }): string {
  return (
    `Title: ${input.documentTitle || 'Untitled'}\n` +
    (input.field ? `Field or journal: ${input.field}\n` : '') +
    `\nMANUSCRIPT:\n${input.text}`
  );
}

// ------------------------------------------------------------------ AI reply in a comment thread

export function commentReplySystemPrompt(language?: string | null): string {
  return (
    `You are ${AI_NAME} replying inside a comment thread on the writer's document. Answer the latest ` +
    'question briefly (at most 120 words), concretely, and kindly. If asked to rewrite, give the rewritten ' +
    'text. Plain text only.' + languageRule(language)
  );
}

export function commentReplyUserPrompt(input: { documentTitle?: string | null; blockText: string; quote: string; thread: string; question: string }): string {
  return (
    `Document title: ${input.documentTitle || 'Untitled'}\nParagraph: ${input.blockText.slice(0, 4000)}\n` +
    `Commented text: ${input.quote.slice(0, 1000)}\n\nThread so far:\n${input.thread}\n\nLatest message: ${input.question}`
  );
}

// ------------------------------------------------------------------ chat

/** `standalone`: the AI Chat page, with no document open. */
export function chatSystemPrompt(language?: string | null, standalone = false): string {
  return (
    (standalone
      ? `You are ${AI_NAME}, a research writing assistant for academic work. `
      : `You are ${AI_NAME}, a research writing assistant inside the writer's document editor. `) +
    'Answer clearly and concisely in Markdown. When you draft text for the document, make it ready to ' +
    'paste. ' + SOURCE_MARKER_RULES + ' Only cite the numbered sources given to you.' + languageRule(language)
  );
}

/** Long documents keep their beginning and end; the middle is the least useful context. */
export function documentContext(text: string, limit = 24000): string {
  const value = text || '';
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.floor(limit * 0.6))}\n\n[... middle of the document omitted ...]\n\n${value.slice(-Math.floor(limit * 0.4))}`;
}

export function chatContextPrompt(input: { useDocument: boolean; documentTitle?: string | null; documentText?: string | null; selection?: string | null; sources: string }): string {
  const parts: string[] = [];
  if (input.useDocument && input.documentText) parts.push(`CURRENT DOCUMENT (${input.documentTitle || 'Untitled'}):\n${documentContext(input.documentText)}`);
  if (input.selection) parts.push(`SELECTED TEXT:\n${input.selection}`);
  parts.push(`SOURCES:\n${input.sources}`);
  return parts.join('\n\n');
}

// ------------------------------------------------------------------ block review (grammar and flow suggestions)

export const BLOCK_REVIEW_SYSTEM_PROMPT = `You are a precise writing reviewer for an academic editor.

Review only the user-authored prose in the provided TEXT.

Rules:
- Return JSON only.
- Do not rewrite or mention citation placeholders such as [[CITATION_1]].
- Never suggest edits that remove, alter, reorder, or absorb citation placeholders.
- Prefer high-signal issues only: grammar, clarity, flow, concision, or rewrite.
- Use category values from: grammar, clarity, flow, concision, rewrite.
- Use severity values from: low, medium, high.
- Limit yourself to the most valuable issues.
- Every issue must quote the exact original substring from TEXT in \`original_text\`.
- \`suggested_text\` must be a direct replacement for \`original_text\`, not the full paragraph.
- Skip issues if the text is already acceptable.

Return a JSON object with this shape:
{
  "issues": [
    {
      "category": "grammar",
      "severity": "low",
      "title": "Subject-verb agreement",
      "explanation": "Short explanation of why this should change.",
      "original_text": "the exact text span from TEXT",
      "suggested_text": "replacement text"
    }
  ]
}
`;

function trimText(value: string | null | undefined, limit = 1000): string {
  const text = (value || '').trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}...`;
}

export function blockReviewPrompt(input: {
  text: string;
  documentTitle?: string | null;
  documentSummary?: string | null;
  previousText?: string | null;
  nextText?: string | null;
  language?: string | null;
  focusText?: string | null;
  preferredAction?: string | null;
  citationPlaceholders: string[];
  maxIssues: number;
}): string {
  return [
    `DOCUMENT TITLE: ${trimText(input.documentTitle, 300) || '(none)'}`,
    `DOCUMENT SUMMARY: ${trimText(input.documentSummary, 500) || '(none)'}`,
    `PREVIOUS TEXT: ${trimText(input.previousText, 500) || '(none)'}`,
    `NEXT TEXT: ${trimText(input.nextText, 500) || '(none)'}`,
    `LANGUAGE: ${(input.language || 'default').trim() || 'default'}`,
    `FOCUS TEXT: ${trimText(input.focusText, 400) || '(none)'}`,
    `PREFERRED ACTION: ${(input.preferredAction || 'default').trim() || 'default'}`,
    `CITATION PLACEHOLDERS: ${JSON.stringify(input.citationPlaceholders)}`,
    `MAX ISSUES: ${input.maxIssues}`,
    'TEXT:',
    input.text,
  ].join('\n\n');
}

// ------------------------------------------------------------------ writing flow (title -> subtitle -> paragraphs -> conclusion)

export function keywordsPrompt(topic: string, title: string, sectionType: string): string {
  return `Extract 3-5 specific academic search keywords for finding scholarly papers.
The input may be in any language, but you MUST output keywords in ENGLISH only,
as academic databases work best with English search terms.

Topic: ${topic}
Title: ${title || 'Not specified'}
Writing: ${sectionType}

Return ONLY a JSON array of ENGLISH keywords:
["keyword1", "keyword2", "keyword3"]`;
}

export type GenerationContext = {
  topic: string;
  document_title?: string | null;
  current_section_title?: string | null;
  current_section_content?: string | null;
  previous_paragraph?: string | null;
};

export type GenerationPaper = { citation_id: string; title: string; authors: string[]; year?: string | number | null; abstract?: string | null };

export function generationPaperContext(papers: GenerationPaper[]): string {
  return papers
    .map(
      (paper, index) => `
Paper ${index + 1} (ID: ${paper.citation_id}):
- Title: ${paper.title}
- Authors: ${paper.authors.length ? paper.authors.join(', ') : 'Unknown'}
- Year: ${paper.year || 'Unknown'}
- Abstract: ${(paper.abstract || 'Not available').slice(0, 300)}...
`,
    )
    .join('');
}

export function generationPrompts(type: string, context: GenerationContext, paperContext: string): { system: string; user: string } {
  if (type === 'title') {
    return {
      system: `You are an expert academic writer. Generate a concise, professional title.
Return ONLY the title text, no quotes or formatting.`,
      user: `Generate a title for an academic document about:
Topic: ${context.topic}

The title should be:
- Clear and specific
- 10-15 words maximum
- Academic in style

Return ONLY the title text.`,
    };
  }
  if (type === 'subtitle') {
    return {
      system: `You are an expert academic writer. Generate a section subtitle.
Return ONLY the subtitle text, no quotes or formatting.`,
      user: `Generate a subtitle for the next section of this document:
Topic: ${context.topic}
Title: ${context.document_title || 'Not set'}
Previous sections: ${context.current_section_content ? context.current_section_content.slice(0, 500) : 'None'}

The subtitle should:
- Introduce a new aspect of the topic
- Be 5-10 words
- Follow logically from previous content

Return ONLY the subtitle text.`,
    };
  }
  if (type === 'conclusive') {
    return {
      system: `You are an expert academic writer.
Write a concluding paragraph that synthesizes key points naturally.
DO NOT use phrases like "In conclusion" or "To summarize".
Include at least 1 citation using {citation_node: PAPER_ID} format.`,
      user: `Write a concluding paragraph for this section:
Topic: ${context.topic}
Section: ${context.current_section_title || 'Current section'}
Content so far: ${context.current_section_content ? context.current_section_content.slice(-1000) : 'None'}
Previous paragraph: ${context.previous_paragraph || 'None'}

USE THESE PAPERS FOR CITATIONS:
${paperContext}

Write ONE paragraph that:
- Synthesizes the key points
- Does NOT start with "In conclusion" or similar
- Includes at least 1 citation using {citation_node: PAPER_ID}
- Ends the section naturally`,
    };
  }
  return {
    system: `You are an expert academic writer.
Write ONE paragraph with at least 1-2 citations.
Use {citation_node: PAPER_ID} format for citations.
Every factual claim must be cited.`,
    user: `Write the next paragraph for this academic document:
Topic: ${context.topic}
Title: ${context.document_title || 'Not set'}
Current section: ${context.current_section_title || 'Main body'}
Previous content: ${context.current_section_content ? context.current_section_content.slice(-500) : 'None'}
Previous paragraph: ${context.previous_paragraph || 'None'}

USE THESE PAPERS FOR CITATIONS:
${paperContext}

Write ONE paragraph that:
- Continues naturally from the previous content
- Includes at least 1-2 citations using {citation_node: PAPER_ID}
- Is substantive and specific, not generic
- Is 3-5 sentences long`,
  };
}
