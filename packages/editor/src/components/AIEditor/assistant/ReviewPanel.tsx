'use client';

import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'react-hot-toast';
import { LuArrowLeft, LuBookCheck, LuCircleAlert, LuCircleCheck, LuCopy, LuEye, LuPlay, LuRotateCw, LuShieldCheck, LuSpeech, LuSpellCheck, LuTriangleAlert, LuUsers } from 'react-icons/lu';
import type { AIEditorComment } from '../../../types/ai-editor';
import type { SourceCheck } from '../../../lib/aiEditor/assistApi';
import { CHECK_CATEGORIES, TONES, type CheckId, type CheckRun, type ReviewMemory } from './reviewChecks';

const CHECKS: { id: CheckId; title: string; description: string; icon: React.ReactNode }[] = [
  { id: 'claims', title: 'Claim check', description: 'Finds unsupported or overstated claims and where to cite.', icon: <LuShieldCheck className="h-4 w-4" /> },
  { id: 'peer', title: 'Peer review', description: 'A referee report: strengths, major and minor issues.', icon: <LuUsers className="h-4 w-4" /> },
  { id: 'sources', title: 'Source quality', description: 'Checks citations for retractions, preprints and wrong DOIs.', icon: <LuBookCheck className="h-4 w-4" /> },
  { id: 'proofread', title: 'Proofread', description: 'Grammar, punctuation, word choice and repetition.', icon: <LuSpellCheck className="h-4 w-4" /> },
  { id: 'tone', title: 'Tone of voice', description: 'Rewrites sentences to match a tone you choose.', icon: <LuSpeech className="h-4 w-4" /> },
];

const GHOST = 'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-[#475569] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a] disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = 'inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--theme-primary,#2563eb)] px-3 text-[13px] font-semibold text-white transition-colors hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60';

function ago(timestamp?: number) {
  if (!timestamp) return '';
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** The Review panel: checks on the whole document, each with its own results. */
export default function ReviewPanel({
  comments,
  memory,
  runs,
  canRun,
  onRun,
  onToneChange,
  onShowComments,
  hasSelection,
  canEdit,
  aiChangeCount,
  onShowInText,
  onResolveAIChanges,
}: {
  comments: AIEditorComment[];
  memory: ReviewMemory;
  runs: Partial<Record<CheckId, CheckRun>>;
  canRun: boolean;
  onRun: (check: CheckId, scope: 'document' | 'selection') => void;
  onToneChange: (tone: string) => void;
  onShowComments: (check: string, category?: string) => void;
  hasSelection: boolean;
  canEdit: boolean;
  /** Videmak AI's tracked changes now in the text. */
  aiChangeCount: number;
  onShowInText: (check: string) => number;
  onResolveAIChanges: (accept: boolean) => void;
}) {
  const [open, setOpen] = useState<CheckId | null>(null);
  const [scope, setScope] = useState<'document' | 'selection'>('document');
  const effectiveScope = scope === 'selection' && hasSelection ? 'selection' : 'document';
  const tone = memory.tone || TONES[0];

  // Open AI comments per check and category (resolved ones no longer count).
  const counts = useMemo(() => {
    const result: Record<string, Record<string, number>> = {};
    for (const comment of comments) {
      if (comment.kind !== 'ai-review' || !comment.check || comment.status === 'resolved') continue;
      result[comment.check] ??= {};
      const category = comment.category || 'other';
      result[comment.check][category] = (result[comment.check][category] || 0) + 1;
    }
    return result;
  }, [comments]);
  // Open suggestions that carry replacement text: these can go into the text as tracked changes.
  const fixable = (check: CheckId) =>
    comments.filter((comment) => comment.kind === 'ai-review' && comment.check === check && comment.status !== 'resolved' && comment.suggestion).length;
  const total = (check: CheckId) => {
    if (check === 'peer') return null;
    if (check === 'sources') return memory.sources ? memory.sources.results.filter((item) => item.status === 'problem' || item.status === 'warning').length : null;
    return Object.values(counts[check] || {}).reduce((sum, value) => sum + value, 0);
  };
  const hasResults = (check: CheckId) =>
    check === 'peer' ? Boolean(memory.peer) : check === 'sources' ? Boolean(memory.sources) : Boolean(memory.ranAt[check]);

  const run = (check: CheckId) => {
    setOpen(check);
    onRun(check, check === 'sources' ? 'document' : effectiveScope);
  };

  if (open) {
    const check = CHECKS.find((item) => item.id === open)!;
    const state = runs[open];
    return (
      <div className="flex h-full min-h-0 flex-col bg-white">
        <div className="flex items-center gap-1 px-2 pb-1 pt-2">
          <button type="button" onClick={() => setOpen(null)} aria-label="All checks" title="All checks" className="grid h-8 w-8 place-items-center rounded-lg text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#0f172a]">
            <LuArrowLeft className="h-4 w-4" />
          </button>
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[#0f172a]">{check.title}</span>
          {canRun ? (
            <button type="button" onClick={() => onRun(open, open === 'sources' ? 'document' : effectiveScope)} disabled={state?.running} title="Run again" aria-label="Run again" className="grid h-8 w-8 place-items-center rounded-lg text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#0f172a] disabled:opacity-50">
              <LuRotateCw className={`h-4 w-4 ${state?.running ? 'animate-spin' : ''}`} />
            </button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-1">
          {state?.running ? (
            <div className="space-y-2 pt-2" aria-label="Checking">
              <p className="text-[13px] text-[#64748b]">{open === 'peer' ? 'Reading the whole document…' : open === 'sources' ? 'Looking up each source…' : 'Checking every paragraph…'}</p>
              {[0, 1, 2].map((index) => <div key={index} className="h-10 animate-pulse rounded-[10px] bg-[#f8fafc]" />)}
            </div>
          ) : state?.error ? (
            <p className="mt-2 rounded-[10px] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">{state.error}</p>
          ) : !hasResults(open) ? (
            <div className="pt-6 text-center">
              <p className="text-[13px] text-[#64748b]">{check.description}</p>
              {open === 'tone' ? <ToneSelect tone={tone} onChange={onToneChange} /> : null}
              <button type="button" disabled={!canRun} onClick={() => onRun(open, open === 'sources' ? 'document' : effectiveScope)} className={`${PRIMARY} mt-4`}><LuPlay className="h-3.5 w-3.5" />Run {check.title.toLowerCase()}</button>
            </div>
          ) : open === 'peer' && memory.peer ? (
            <PeerReport report={memory.peer.report} recommendation={memory.peer.recommendation} truncated={memory.peer.truncated} />
          ) : open === 'sources' && memory.sources ? (
            <SourceResults results={memory.sources.results} labels={memory.sources.labels} />
          ) : open === 'claims' || open === 'proofread' || open === 'tone' ? (
            <div>
              {open === 'tone' ? <ToneSelect tone={tone} onChange={onToneChange} /> : null}
              {memory.scope?.[open] === 'selection' ? <span className="mb-1.5 inline-block rounded-md bg-[#f1f5f9] px-1.5 py-0.5 text-[11.5px] font-medium text-[#475569]">Selected text only</span> : null}
              <p className="mt-1 text-[13px] text-[#334155]">
                {total(open) ? `${total(open)} suggestion${total(open) === 1 ? '' : 's'} to look at.` : aiChangeCount ? 'All suggestions are in the text.' : 'Nothing to change. Looks good.'}
              </p>
              {fixable(open) && canEdit ? (
                <button type="button" onClick={() => onShowInText(open)} className={`${PRIMARY} mt-3 w-full justify-center`}><LuEye className="h-4 w-4" />Show {fixable(open)} change{fixable(open) === 1 ? '' : 's'} in the text</button>
              ) : null}
              {total(open) ? (
                <button type="button" onClick={() => onShowComments(open)} className={`${GHOST} mt-1.5 w-full justify-center`}>Review in comments</button>
              ) : null}
              {aiChangeCount ? (
                <div className="mt-3 flex items-center gap-1 rounded-[10px] bg-[#f8fafc] px-2.5 py-1.5 text-[12.5px] text-[#475569]">
                  <span className="min-w-0 flex-1"><span className="font-semibold text-[#0f172a]">{aiChangeCount}</span> tracked change{aiChangeCount === 1 ? '' : 's'} in the text</span>
                  <button type="button" onClick={() => onResolveAIChanges(true)} className="h-7 rounded-md px-2 font-semibold text-[#15803d] hover:bg-[#f0fdf4]">Accept all</button>
                  <button type="button" onClick={() => onResolveAIChanges(false)} className="h-7 rounded-md px-2 font-semibold text-[#b91c1c] hover:bg-[#fef2f2]">Reject all</button>
                </div>
              ) : null}
              <h4 className="mb-1 mt-5 text-[12px] font-medium text-[#94a3b8]">Breakdown</h4>
              <ul>
                {CHECK_CATEGORIES[open].map(([category, label]) => {
                  const count = counts[open]?.[category] || 0;
                  return (
                    <li key={category}>
                      <button
                        type="button"
                        disabled={!count}
                        onClick={() => onShowComments(open, category)}
                        className="flex h-10 w-full items-center justify-between rounded-[10px] px-2.5 text-left text-[13.5px] text-[#0f172a] transition-colors hover:bg-[#f8fafc] disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        {label}
                        {count ? <span className="min-w-[22px] rounded-full bg-[#fef3c7] px-1.5 text-center text-[12px] font-semibold text-[#92400e]">{count}</span> : <LuCircleCheck className="h-4 w-4 text-[#22c55e]" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {memory.ranAt[open] ? <p className="mt-3 px-2.5 text-[12px] text-[#94a3b8]">Ran {ago(memory.ranAt[open]).toLowerCase()}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-white px-3 pb-5 pt-3">
      <div className="mb-2.5 flex items-center gap-2 px-1">
        <span className="text-[12.5px] text-[#64748b]">Check</span>
        <div className="inline-flex rounded-[9px] bg-[#f1f5f9] p-0.5">
          {(['document', 'selection'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={effectiveScope === value}
              disabled={value === 'selection' && !hasSelection}
              title={value === 'selection' && !hasSelection ? 'Select text in the document first' : undefined}
              onClick={() => setScope(value)}
              className={`h-7 rounded-[7px] px-2.5 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${effectiveScope === value ? 'bg-white text-[#0f172a] shadow-[0_1px_2px_rgba(15,23,42,.12)]' : 'text-[#64748b] hover:text-[#0f172a]'}`}
            >
              {value === 'document' ? 'Whole document' : 'Selection'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {CHECKS.map((check) => {
          const state = runs[check.id];
          const count = total(check.id);
          const ran = memory.ranAt[check.id];
          return (
            <article key={check.id} className="rounded-[12px] border border-[#eef2f6] px-3.5 pb-3 pt-3 transition-colors hover:border-[#e2e8f0]">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eff6ff] text-[var(--theme-primary,#2563eb)]">{check.icon}</span>
                <h3 className="min-w-0 flex-1 text-[14px] font-semibold text-[#0f172a]">{check.title}</h3>
                {count ? <span className="rounded-full bg-[#fef3c7] px-2 text-[12px] font-semibold leading-5 text-[#92400e]">{count}</span> : null}
              </div>
              <p className="mt-1.5 text-[13px] leading-[1.45] text-[#64748b]">{check.description}</p>
              <div className="-ml-1 mt-2.5 flex items-center gap-1">
                {hasResults(check.id) ? (
                  <>
                    <button type="button" onClick={() => setOpen(check.id)} className={GHOST}><LuEye className="h-4 w-4" />View results</button>
                    {canRun ? (
                      <button type="button" onClick={() => run(check.id)} disabled={state?.running} title="Run again" aria-label={`Run ${check.title} again`} className="grid h-8 w-8 place-items-center rounded-lg text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a] disabled:opacity-50">
                        <LuRotateCw className={`h-4 w-4 ${state?.running ? 'animate-spin' : ''}`} />
                      </button>
                    ) : null}
                  </>
                ) : (
                  <button type="button" onClick={() => run(check.id)} disabled={!canRun || state?.running} className={GHOST}>
                    <LuPlay className="h-3.5 w-3.5" />{state?.running ? 'Running…' : 'Run'}
                  </button>
                )}
                {ran ? <span className="ml-auto text-[12px] text-[#94a3b8]">{ago(ran)}</span> : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ToneSelect({ tone, onChange }: { tone: string; onChange: (tone: string) => void }) {
  return (
    <label className="mt-3 flex items-center justify-center gap-2 text-[13px] text-[#64748b]">
      Target tone
      <select value={tone} onChange={(event) => onChange(event.target.value)} className="h-8 rounded-lg border border-[#e2e8f0] bg-white px-2 text-[13px] font-medium text-[#0f172a] outline-none focus:border-[var(--theme-primary,#2563eb)]">
        {TONES.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

const RECOMMENDATION_TONE: Record<string, string> = {
  accept: 'bg-[#f0fdf4] text-[#15803d]',
  'minor revision': 'bg-[#eff6ff] text-[#1d4ed8]',
  'major revision': 'bg-[#fffbeb] text-[#b45309]',
  reject: 'bg-[#fef2f2] text-[#b91c1c]',
};

function PeerReport({ report, recommendation, truncated }: { report: string; recommendation: string | null; truncated: boolean }) {
  const body = report.replace(/\n?Recommendation:.*$/i, '').trim();
  return (
    <div>
      <div className="flex items-center gap-2">
        {recommendation ? (
          <span className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold ${RECOMMENDATION_TONE[recommendation.toLowerCase()] || 'bg-[#f1f5f9] text-[#334155]'}`}>{recommendation}</span>
        ) : null}
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(report).then(() => toast.success('Report copied'))}
          className={`${GHOST} ml-auto`}
        >
          <LuCopy className="h-4 w-4" />Copy
        </button>
      </div>
      {truncated ? <p className="mt-2 text-[12px] text-[#94a3b8]">Long document: the review read the first 15,000 words.</p> : null}
      <div className="mt-2 text-[13.5px] leading-[1.6] text-[#334155] [&_h2]:mb-1 [&_h2]:mt-4 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h2]:text-[#0f172a] [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_strong]:text-[#0f172a] [&_ul]:list-disc [&_ul]:pl-5">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
      </div>
    </div>
  );
}

function SourceResults({ results, labels }: { results: SourceCheck[]; labels: Record<string, string> }) {
  const problems = results.filter((item) => item.status === 'problem').length;
  const warnings = results.filter((item) => item.status === 'warning').length;
  const sorted = [...results].sort((a, b) => ['problem', 'warning', 'error', 'ok'].indexOf(a.status) - ['problem', 'warning', 'error', 'ok'].indexOf(b.status));
  return (
    <div>
      <p className="text-[13px] text-[#334155]">
        {results.length} source{results.length === 1 ? '' : 's'} checked
        {problems ? <> · <span className="font-semibold text-[#b91c1c]">{problems} to fix</span></> : null}
        {warnings ? <> · <span className="font-semibold text-[#b45309]">{warnings} to look at</span></> : null}
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {sorted.map((item) => (
          <li key={item.key} className="rounded-[10px] border border-[#eef2f6] px-3 py-2">
            <div className="flex items-start gap-2">
              {item.status === 'ok' ? <LuCircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#22c55e]" /> : item.status === 'problem' ? <LuCircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#dc2626]" /> : <LuTriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#d97706]" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-[#0f172a]">{labels[item.key] || item.paper?.title || item.key}</div>
                {item.paper ? <div className="truncate text-[12px] text-[#64748b]">{[item.paper.title, item.paper.year].filter(Boolean).join(' · ')}</div> : null}
                {item.flags.length ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {item.flags.map((flag) => (
                      <span key={flag.kind} className={`rounded-md px-1.5 py-px text-[11.5px] font-medium ${flag.kind === 'old' ? 'bg-[#f1f5f9] text-[#475569]' : flag.kind === 'preprint' ? 'bg-[#fffbeb] text-[#b45309]' : 'bg-[#fef2f2] text-[#b91c1c]'}`}>{flag.label}</span>
                    ))}
                  </div>
                ) : null}
                {item.status === 'error' ? <div className="text-[12px] text-[#94a3b8]">Could not check right now</div> : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
