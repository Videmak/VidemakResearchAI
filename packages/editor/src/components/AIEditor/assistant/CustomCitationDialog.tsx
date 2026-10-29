'use client';

import React, { useState } from 'react';
import { LuX } from 'react-icons/lu';
import { lookupPaper } from '../../../lib/aiEditor/assistApi';

const escapeField = (value: string) => value.replace(/[{}\\]/g, '').trim();

/** "Add custom citation": a DOI, a BibTeX entry, or the details typed by hand. */
export default function CustomCitationDialog({ isOpen, onClose, onCite }: { isOpen: boolean; onClose: () => void; onCite: (bibtex: string, url?: string) => void }) {
  const [mode, setMode] = useState<'doi' | 'bibtex' | 'manual'>('doi');
  const [doi, setDoi] = useState('');
  const [bibtex, setBibtex] = useState('');
  const [fields, setFields] = useState({ authors: '', title: '', year: '', journal: '', url: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isOpen) return null;

  const submit = async () => {
    setError(null);
    if (mode === 'doi') {
      const value = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
      if (!/^10\.\d{4,9}\/\S+$/.test(value)) return setError('Enter a DOI like 10.1056/NEJMoa2034577.');
      setBusy(true);
      try {
        const paper = await lookupPaper(value);
        onCite(paper.bibtex, `https://doi.org/${value}`);
        onClose();
      } catch (caught) {
        setError((caught as Error).message || 'No paper found for that DOI.');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (mode === 'bibtex') {
      if (!/^\s*@\w+\s*\{[^,]+,/.test(bibtex)) return setError('Paste one BibTeX entry, starting with @article{… or similar.');
      onCite(bibtex.trim());
      onClose();
      return;
    }
    if (!fields.title.trim() || !fields.authors.trim()) return setError('Add at least the authors and the title.');
    const authors = fields.authors.split(/;|\band\b/).map((name) => escapeField(name)).filter(Boolean);
    const last = (authors[0] || 'anon').split(/[ ,]+/).filter(Boolean)[0] || 'anon';
    const key = `${last.toLowerCase().replace(/[^a-z]/g, '') || 'anon'}${fields.year.trim() || 'nd'}`;
    const entry = [
      `@article{${key},`,
      `  author = {${authors.join(' and ')}},`,
      `  title = {${escapeField(fields.title)}},`,
      fields.journal.trim() ? `  journal = {${escapeField(fields.journal)}},` : '',
      fields.year.trim() ? `  year = {${escapeField(fields.year)}},` : '',
      fields.url.trim() ? `  url = {${escapeField(fields.url)}},` : '',
      '}',
    ].filter(Boolean).join('\n');
    onCite(entry, fields.url.trim() || undefined);
    onClose();
  };

  const input = 'h-10 w-full rounded-[10px] border border-[#e5e7eb] px-3 text-[14px] outline-none focus:border-[var(--theme-primary,#2563eb)] focus:shadow-[0_0_0_4px_#eff6ff]';
  return (
    <div className="fixed inset-0 z-[13060] flex items-end justify-center bg-[rgba(15,23,42,0.35)] sm:items-center" role="dialog" aria-modal="true" aria-label="Add custom citation">
      <div className="w-full max-w-[480px] rounded-t-[24px] bg-white p-5 border border-[#e5e7eb] shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)] sm:rounded-[16px]">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[18px] font-bold text-[#0f172a]">Add custom citation</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-[#64748b] hover:bg-[#f1f5f9]"><LuX className="h-5 w-5" /></button>
        </div>
        <div className="mb-3 inline-flex rounded-full bg-[#f1f5f9] p-1 text-[13px]">
          {(['doi', 'bibtex', 'manual'] as const).map((value) => (
            <button key={value} type="button" onClick={() => setMode(value)} className={`h-8 rounded-full px-3.5 ${mode === value ? 'bg-white font-medium text-[#0f172a] shadow-sm' : 'text-[#64748b]'}`}>
              {value === 'doi' ? 'DOI' : value === 'bibtex' ? 'BibTeX' : 'Manual'}
            </button>
          ))}
        </div>
        {mode === 'doi' ? <input autoFocus value={doi} onChange={(event) => setDoi(event.target.value)} placeholder="10.1056/NEJMoa2034577" aria-label="DOI" className={input} /> : null}
        {mode === 'bibtex' ? (
          <textarea autoFocus value={bibtex} onChange={(event) => setBibtex(event.target.value)} rows={7} placeholder="@article{smith2020, ...}" aria-label="BibTeX" className="w-full rounded-[10px] border border-[#e5e7eb] px-3 py-2 font-mono text-[12.5px] outline-none focus:border-[var(--theme-primary,#2563eb)] focus:shadow-[0_0_0_4px_#eff6ff]" />
        ) : null}
        {mode === 'manual' ? (
          <div className="space-y-2">
            <input autoFocus value={fields.authors} onChange={(event) => setFields({ ...fields, authors: event.target.value })} placeholder="Authors (Smith, Jane; Doe, John)" aria-label="Authors" className={input} />
            <input value={fields.title} onChange={(event) => setFields({ ...fields, title: event.target.value })} placeholder="Title" aria-label="Title" className={input} />
            <div className="flex gap-2">
              <input value={fields.year} onChange={(event) => setFields({ ...fields, year: event.target.value })} placeholder="Year" aria-label="Year" className={`${input} w-24 shrink-0`} />
              <input value={fields.journal} onChange={(event) => setFields({ ...fields, journal: event.target.value })} placeholder="Journal or publisher" aria-label="Journal" className={input} />
            </div>
            <input value={fields.url} onChange={(event) => setFields({ ...fields, url: event.target.value })} placeholder="URL (optional)" aria-label="URL" className={input} />
          </div>
        ) : null}
        {error ? <p className="mt-2 text-[13px] text-[#991b1b]">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-[9px] border border-[#e5e7eb] bg-white px-4 text-[13px] font-semibold text-[#334155] hover:bg-[#f8fafc]">Cancel</button>
          <button type="button" disabled={busy} onClick={() => void submit()} className="h-9 rounded-[10px] bg-[var(--theme-primary,#2563eb)] shadow-[0_6px_16px_-8px_rgba(37,99,235,0.8)] px-5 text-[13px] font-semibold text-white disabled:opacity-60">{busy ? 'Looking up…' : 'Cite'}</button>
        </div>
      </div>
    </div>
  );
}
