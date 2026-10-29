'use client';

import React, { useState } from 'react';
import { LuBookmark, LuCheck, LuCopy, LuExternalLink, LuQuote } from 'react-icons/lu';
import { paperAuthorsLabel, type Paper } from '../../../lib/aiEditor/assistApi';

export type PaperCardAction = {
  onCite?: () => void;
  onView?: () => void;
  onSave?: () => Promise<void> | void;
  saved?: boolean;
  citeLabel?: string;
};

export function formatCount(value?: number | null) {
  if (!value) return '0';
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value);
}

/** "Rasch B, Born J" (two authors), "Walker M et al." (more). */
function shortAuthors(paper: Pick<Paper, 'authors' | 'extra_author_count'>) {
  const names = (paper.authors || []).map((author) => (author.name || '').trim()).filter(Boolean).map((name) => {
    if (name.includes(',')) {
      const [last, first] = name.split(',');
      return `${last.trim()}${first?.trim() ? ` ${first.trim()[0]}` : ''}`;
    }
    const parts = name.split(/\s+/);
    const last = parts.pop() || name;
    return parts.length ? `${last} ${parts[0][0]}` : last;
  });
  if (!names.length) return paperAuthorsLabel(paper);
  return names.length > 2 || (paper.extra_author_count || 0) > 0 ? `${names[0]} et al.` : names.join(', ');
}

function typeLabel(type?: string | null) {
  if (!type) return null;
  const text = type.replace(/[-_]+/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : null;
}

/** A paper result (Scholar or Library) with Cite / Save / View, as in the mockups' paper cards. */
export default function PaperCard({
  paper,
  actions,
  compact = false,
  badge,
}: {
  paper: Pick<Paper, 'title' | 'authors' | 'extra_author_count' | 'year' | 'source_name' | 'cited_by_count' | 'is_open_access' | 'abstract'> & { type?: string | null };
  actions: PaperCardAction;
  compact?: boolean;
  badge?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const abstract = (paper.abstract || '').trim();
  const kind = typeLabel(paper.type);
  const cited = typeof paper.cited_by_count === 'number' ? paper.cited_by_count : null;
  const meta = [shortAuthors(paper), paper.source_name, paper.year].filter(Boolean).join(' · ');

  const facts = [kind, cited ? `Cited by ${formatCount(cited)}` : null].filter(Boolean).join(' · ');
  const ghost = 'inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12.5px] font-medium text-[#475569] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a] disabled:cursor-default disabled:hover:bg-transparent';

  return (
    <article className="ce-paper-card rounded-[12px] border border-[#eef2f6] bg-white px-3 pb-2 pt-2.5 transition-colors hover:border-[#e2e8f0]">
      {badge || facts || paper.is_open_access ? (
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] font-medium text-[#94a3b8]">
          {badge}
          {facts ? <span>{facts}</span> : null}
          {paper.is_open_access ? <span className="inline-flex items-center gap-1 text-[#15803d]"><span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />Open access</span> : null}
        </div>
      ) : null}
      <h4 className="text-[14px] font-semibold leading-[1.4] text-[#0f172a]">{paper.title}</h4>
      <p className="mt-0.5 text-[12.5px] leading-snug text-[#64748b]">{meta}</p>
      {!compact && abstract ? (
        <p className={`mt-1.5 text-[12.5px] leading-[1.5] text-[#475569] ${expanded ? '' : 'line-clamp-2'}`}>
          {abstract}
          {abstract.length > 160 ? (
            <button type="button" onClick={() => setExpanded((value) => !value)} className="ml-1 font-medium text-[var(--theme-primary,#2563eb)] hover:underline">
              {expanded ? 'Less' : 'More'}
            </button>
          ) : null}
        </p>
      ) : null}
      <div className="-ml-0.5 mt-1.5 flex flex-wrap items-center gap-0.5">
        {actions.onCite ? (
          <button
            type="button"
            onClick={actions.onCite}
            className="mr-1 inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--theme-primary,#2563eb)] px-2.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#1d4ed8]"
          >
            {actions.citeLabel === 'Copy' ? <LuCopy className="h-3.5 w-3.5" /> : <LuQuote className="h-3.5 w-3.5" />}{actions.citeLabel || 'Cite'}
          </button>
        ) : null}
        {actions.onSave ? (
          <button
            type="button"
            disabled={saving || actions.saved}
            onClick={async () => {
              setSaving(true);
              try {
                await actions.onSave?.();
              } finally {
                setSaving(false);
              }
            }}
            className={ghost}
          >
            {actions.saved ? <><LuCheck className="h-3.5 w-3.5 text-[#16a34a]" />Saved</> : <><LuBookmark className="h-3.5 w-3.5" />{saving ? 'Saving…' : 'Save'}</>}
          </button>
        ) : null}
        {actions.onView ? (
          <button type="button" onClick={actions.onView} className={ghost}>
            <LuExternalLink className="h-3.5 w-3.5" />Open
          </button>
        ) : null}
      </div>
    </article>
  );
}
