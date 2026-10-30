'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LuCheck, LuCircleAlert, LuLoader, LuZap } from 'react-icons/lu';
import { getImportJob, type ImportJob } from '../../../utils/libraryApi';
import { notifyLibraryChanged } from '../../../lib/aiEditor/references';

/** Pieces shared by the Library's add dialog and its Zotero/Mendeley panes. */

export const plural = (count: number, word: string) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;

export function UpgradeCard({ title, text, onUpgrade }: { title: string; text: string; onUpgrade: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-[#eff6ff] text-[var(--theme-primary,#2563eb)]"><LuZap className="h-5 w-5" /></span>
      <p className="mt-4 text-[16px] font-semibold text-[#0f172a]">{title}</p>
      <p className="mt-1.5 max-w-[380px] text-[14px] leading-relaxed text-[#64748b]">{text}</p>
      <button type="button" onClick={onUpgrade} className="mt-5 inline-flex h-10 items-center gap-2 rounded-[10px] bg-[var(--theme-primary,#2563eb)] px-5 text-[14px] font-semibold text-white hover:opacity-90">
        <LuZap className="h-4 w-4" />See plans
      </button>
    </div>
  );
}

/** Progress of a background import, then what it did. */
export function ImportProgress({ job, onAgain }: { job: ImportJob; onAgain: () => void }) {
  const done = job.added + job.skipped + job.failed;
  const share = job.total ? Math.min(100, Math.round((done / job.total) * 100)) : job.status === 'running' ? 8 : 100;
  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-4" data-testid="import-progress">
      <div className="flex items-center gap-2 text-[14px] font-semibold text-[#0f172a]">
        {job.status === 'running' ? <LuLoader className="h-4 w-4 animate-spin text-[var(--theme-primary,#2563eb)]" /> : job.status === 'done' ? <LuCheck className="h-4 w-4 text-[#16a34a]" /> : <LuCircleAlert className="h-4 w-4 text-[#dc2626]" />}
        {job.status === 'running' ? `Importing ${job.label}…` : job.status === 'done' ? 'Import finished' : 'Import stopped'}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#f1f5f9]"><div className="h-full rounded-full bg-[var(--theme-primary,#2563eb)] transition-[width]" style={{ width: `${share}%` }} /></div>
      <p className="mt-2.5 text-[13px] text-[#475569]">
        {plural(job.added, 'item')} added{job.pdfs ? `, ${plural(job.pdfs, 'PDF')}` : ''}
        {job.skipped ? ` · ${job.skipped.toLocaleString('en-US')} already in your Library` : ''}
        {job.failed ? ` · ${job.failed.toLocaleString('en-US')} not found` : ''}
        {job.total ? ` · ${done.toLocaleString('en-US')} of ${job.total.toLocaleString('en-US')}` : ''}
      </p>
      {job.pdfs_over_limit > 0 && <p className="mt-1.5 text-[13px] text-[#b45309]">{plural(job.pdfs_over_limit, 'PDF')} not added: your plan's Library is full. The references were added.</p>}
      {job.error && <p className="mt-1.5 text-[13px] text-[#dc2626]">{job.error}</p>}
      {job.status !== 'running' && (
        <button type="button" onClick={onAgain} className="mt-3 text-[13px] font-semibold text-[var(--theme-primary,#2563eb)] hover:underline">Import more</button>
      )}
    </div>
  );
}

/** Polls an import until it finishes; the Library refreshes as items arrive. */
export function useImportJob() {
  const [job, setJob] = useState<ImportJob | null>(null);
  const timer = useRef<number | null>(null);
  const stop = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; };
  const follow = useCallback((id: string) => {
    stop();
    const tick = async () => {
      const next = await getImportJob(id).catch(() => null);
      if (next) setJob(next);
      if (next && next.status !== 'running') { notifyLibraryChanged(); return; }
      if (next && next.added) notifyLibraryChanged();
      timer.current = window.setTimeout(() => void tick(), 1500);
    };
    void tick();
  }, []);
  useEffect(() => stop, []);
  return { job, follow, reset: () => { stop(); setJob(null); } };
}

export function FindPdfs({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 text-[13.5px] text-[#334155]">
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[var(--theme-primary,#2563eb)]" />
      Add PDFs when there is one (they count towards your plan's Library)
    </label>
  );
}
