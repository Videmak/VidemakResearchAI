'use client';

import { useCallback, useEffect, useState } from 'react';
import { LuCloudUpload, LuRefreshCw, LuZap } from 'react-icons/lu';
import { Button, inputClass } from '@/components/app/ui';
import { api } from '@/lib/session';
import { when, type Notice } from './adminTypes';

type CopyStatus = { running: boolean; total: number; copied: number; skipped: number; failed: number; started_at: string | null; finished_at: string | null; errors: string[] };
type NewsletterInfo = {
  on: boolean;
  counts: { subscribed: number; left: number; waiting: number; unconfirmed: number; errors: number };
  last_sync: { ran_at: string; imported: number; updated: number; mirrored: number; failed: number; error: string | null } | null;
};

const n = (value: number) => value.toLocaleString('en-US');

/** Admin › Storage: copies files saved on this server into the bucket (never deletes them here). */
export function StorageCopyPanel({ provider, notify }: { provider: string; notify: (notice: Notice) => void }) {
  const [copy, setCopy] = useState<CopyStatus | null>(null);
  const load = useCallback(() => api<{ copy: CopyStatus }>('/api/admin/storage').then((result) => setCopy(result.copy)).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!copy?.running) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [copy?.running, load]);

  if (provider === 'local' || !provider) return null;
  const start = async () => {
    try { setCopy((await api<{ copy: CopyStatus }>('/api/admin/storage/copy', { method: 'POST' })).copy); }
    catch (caught) { notify({ tone: 'error', text: (caught as Error).message }); }
  };
  const done = copy && copy.started_at;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line-2 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">Files saved on this server</p>
        <p className="text-[12.5px] text-muted">
          {copy?.running ? `Copying… ${n(copy.copied + copy.skipped + copy.failed)} of ${n(copy.total)}`
            : done ? `Last copy ${when(copy.finished_at || copy.started_at!)}: ${n(copy.copied)} copied, ${n(copy.skipped)} already there${copy.failed ? `, ${n(copy.failed)} failed` : ''}`
            : 'Still readable. Copy them so everything lives in the bucket.'}
        </p>
        {copy?.errors.length ? <p className="mt-1 break-words text-[12px] text-red-700">{copy.errors[0]}</p> : null}
      </div>
      <Button size="sm" onClick={() => void start()} disabled={copy?.running}><LuCloudUpload size={15} />{copy?.running ? 'Copying…' : 'Copy to bucket'}</Button>
    </div>
  );
}

/** Admin › Newsletter: who is on the MailCheap list, and a manual sync. */
export function NewsletterPanel({ provider, notify }: { provider: string; notify: (notice: Notice) => void }) {
  const [info, setInfo] = useState<NewsletterInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<NewsletterInfo>('/api/admin/newsletter').then(setInfo).catch(() => {}), []);
  useEffect(() => { void load(); }, [load, provider]);
  if (!provider) return null;

  const sync = async () => {
    setBusy(true);
    try {
      const result = await api<{ result: NonNullable<NewsletterInfo['last_sync']> }>('/api/admin/newsletter/sync', { method: 'POST' });
      const r = result.result;
      notify(r.error ? { tone: 'error', text: r.error } : { tone: 'ok', text: `Synced: ${n(r.imported)} added, ${n(r.updated)} updated, ${n(r.mirrored)} left via MailCheap.` });
      await load();
    } catch (caught) { notify({ tone: 'error', text: (caught as Error).message }); } finally { setBusy(false); }
  };

  const counts = info?.counts;
  const stats = counts ? [
    ['On the list', counts.subscribed], ['Waiting', counts.waiting], ['Left', counts.left], ['Email not confirmed', counts.unconfirmed],
  ] as const : [];
  return (
    <div className="border-t border-line-2 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium">Subscribers</p>
          <p className="text-[12.5px] text-muted">
            {info?.last_sync ? `Last sync ${when(info.last_sync.ran_at)}${info.last_sync.error ? ' · failed' : ''}` : 'Syncs every 15 minutes.'}
          </p>
        </div>
        <Button size="sm" onClick={() => void sync()} disabled={busy || !info?.on}><LuRefreshCw size={15} className={busy ? 'animate-spin' : ''} />{busy ? 'Syncing…' : 'Sync now'}</Button>
      </div>
      {stats.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line-2 bg-soft px-3 py-2">
              <dt className="text-[12px] text-muted">{label}</dt>
              <dd className="text-[17px] font-semibold tabular-nums">{n(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {info?.last_sync?.error && <p className="mt-2 break-words text-[12.5px] text-red-700">{info.last_sync.error}</p>}
    </div>
  );
}

type CloudSummary = { sold_cents: number; credits_sold: number; free_used: number; paid_used: number; keys: number; accounts: number };

/** Admin › Cloud: this month's credit sales and use, and credits given to an account by hand. */
export function CloudCreditsPanel({ notify }: { notify: (notice: Notice) => void }) {
  const [summary, setSummary] = useState<CloudSummary | null>(null);
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<CloudSummary>('/api/admin/accounts/credits').then(setSummary).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
  const give = async () => {
    setBusy(true);
    try {
      const result = await api<{ balance: number }>('/api/admin/accounts/credits', { method: 'POST', body: JSON.stringify({ email: email.trim(), credits: Number(amount), note: note.trim() || undefined }) });
      notify({ tone: 'ok', text: `Added ${n(Number(amount))} credits to ${email.trim()}. Balance: ${n(result.balance)}.` });
      setEmail(''); setAmount(''); setNote('');
      void load();
    } catch (caught) { notify({ tone: 'error', text: (caught as Error).message }); } finally { setBusy(false); }
  };
  return (
    <div className="border-t border-line-2 px-5 py-4">
      <p className="text-[14px] font-medium">Videmak Cloud this month</p>
      <p className="mt-1 text-[13px] text-muted">
        {summary ? `${n(summary.credits_sold)} credits sold ($${(summary.sold_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}) · ${n(Math.round(summary.paid_used))} paid and ${n(Math.round(summary.free_used))} free credits used · ${n(summary.keys)} keys in ${n(summary.accounts)} accounts` : 'Loading…'}
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1.4fr_.7fr_1fr_auto]">
        <input className={`${inputClass} h-10 text-[14px]`} placeholder="Account email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <input className={`${inputClass} h-10 text-[14px]`} placeholder="Credits" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))} />
        <input className={`${inputClass} h-10 text-[14px]`} placeholder="Note (optional)" value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />
        <Button size="sm" className="h-10" disabled={busy || !email.includes('@') || !Number(amount)} onClick={() => void give()}><LuZap size={15} />Give credits</Button>
      </div>
    </div>
  );
}
