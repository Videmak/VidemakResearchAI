'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LuCheck, LuCopy, LuKeyRound, LuPlus, LuZap } from 'react-icons/lu';
import { AppFrame } from '@/components/app/AppFrame';
import { Button, ButtonLink, Card, CardHeader, EmptyState, StatusPill, inputClass } from '@/components/app/ui';
import { api, useSession } from '@/lib/session';

type Wallet = { balance: number; free_per_day: number; free_used: number; free_left: number; resets_at: string; email_confirmed: boolean };
type Key = { id: string; name: string; prefix: string; mode: string; monthly_credit_cap: number | null; created_at: string; last_used_at: string | null; revoked_at: string | null; credits_this_month: number };
type Pack = { id: string; credits: number; cents: number; usd: number; usd_per_1000: number };
type Overview = {
  wallet: Wallet;
  starter_credits: number;
  keys: Key[];
  usage: { service: string; label: string; calls: number; quantity: number; credits: number; free: number; paid: number }[];
  ledger: { kind: string; credits: number; amount_cents: number | null; note: string | null; created_at: string }[];
  topup: { enabled: boolean; threshold: number; pack: string; monthly_limit_usd: number; error: string | null } | null;
  payments_enabled: boolean;
  packs: Pack[];
};

const number = (value: number, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
const credits = (value: number) => (value > 0 && value < 0.01 ? '<0.01' : number(value, value < 10 ? 2 : 0));
/** $29.90, $119, $4,990. */
const usd = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0 });
const date = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const KIND: Record<string, string> = { purchase: 'Purchase', topup: 'Top-up', starter: 'Starter', grant: 'Added by Videmak', refund: 'Refund' };

/** Videmak Cloud: credits, automatic top-up, API keys and this month's use. */
export default function DeveloperKeysPage() {
  const router = useRouter();
  const { user, loading } = useSession();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyName, setKeyName] = useState('');
  const [copied, setCopied] = useState(false);
  const [topup, setTopup] = useState<Overview['topup']>(null);
  const [capEdit, setCapEdit] = useState<{ id: string; value: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<Overview>('/api/cloud');
      setData(next);
      setTopup((current) => current ?? next.topup);
    } catch (caught) { setError((caught as Error).message); }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/login?next=/developers/keys'); return; }
    // Back from Stripe: add the credits at once (the webhook does the same, only once).
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    const outcome = params.get('credits');
    if (outcome) window.history.replaceState(null, '', '/developers/keys');
    if (outcome === 'paid' && session) {
      api<{ paid: boolean }>('/api/cloud/credits/complete', { method: 'POST', body: JSON.stringify({ session }) })
        .then((result) => setNotice(result.paid ? 'Payment received. Your credits are ready.' : 'Payment is still processing. Credits appear when it clears.'))
        .catch((caught) => setError((caught as Error).message))
        .finally(() => void load());
      return;
    }
    if (outcome === 'cancelled') setNotice('Payment cancelled. Nothing was charged.');
    void load();
  }, [load, loading, router, user]);

  const act = async (id: string, work: () => Promise<void>) => {
    setBusy(id); setError(null); setNotice(null);
    try { await work(); } catch (caught) { setError((caught as Error).message); } finally { setBusy(null); }
  };

  const buy = (pack: string) => act(`buy-${pack}`, async () => {
    const { url } = await api<{ url: string }>('/api/cloud/credits/checkout', { method: 'POST', body: JSON.stringify({ pack }) });
    window.location.assign(url);
  });

  const createKey = () => act('create', async () => {
    const created = await api<{ key: string }>('/api/cloud/keys', { method: 'POST', body: JSON.stringify({ name: keyName.trim() || 'Default key' }) });
    setNewKey(created.key); setCopied(false); setKeyName('');
    await load();
  });

  const revoke = (id: string) => act(`revoke-${id}`, async () => {
    await api(`/api/cloud/keys/${id}`, { method: 'DELETE' });
    await load();
  });

  const saveCap = () => capEdit && act(`cap-${capEdit.id}`, async () => {
    const value = capEdit.value.trim();
    await api(`/api/cloud/keys/${capEdit.id}`, { method: 'PATCH', body: JSON.stringify({ monthly_credit_cap: value ? Math.max(1, Math.round(Number(value))) : null }) });
    setCapEdit(null);
    await load();
  });

  const saveTopup = () => topup && act('topup', async () => {
    await api('/api/cloud/topup', { method: 'PUT', body: JSON.stringify({ enabled: topup.enabled, threshold: topup.threshold, pack: topup.pack, monthly_limit_usd: topup.monthly_limit_usd }) });
    setNotice(topup.enabled ? 'Automatic top-up is on.' : 'Automatic top-up is off.');
    setTopup(null);
    await load();
  });

  const wallet = data?.wallet;
  const freeShare = wallet && wallet.free_per_day ? Math.min(100, (wallet.free_used / wallet.free_per_day) * 100) : 0;
  const activeKeys = (data?.keys ?? []).filter((key) => !key.revoked_at);

  return (
    <AppFrame title="Keys and credits" actions={<ButtonLink href="/developers" variant="ghost" size="sm">Docs and prices</ButtonLink>}>
      <div className="flex flex-col gap-5">
        {notice && <p role="status" className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-[14px] text-brand-600">{notice}</p>}
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-700">{error}</p>}

        <Card>
          <CardHeader title="Credits" description="1 credit is one paper or file request. AI, reviews and files are priced in credits too." />
          <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
            <div>
              <p className="text-[13px] font-medium text-muted">Balance</p>
              <p className="mt-1 text-[34px] font-bold leading-none tracking-[-0.02em] tabular-nums" data-testid="credit-balance">{wallet ? credits(wallet.balance) : '—'}</p>
              <p className="mt-2 text-[13px] text-muted">Credits you buy don&apos;t expire.</p>
            </div>
            <div>
              <p className="text-[13px] font-medium text-muted">Free today</p>
              {wallet && wallet.email_confirmed ? (
                <>
                  <p className="mt-1 text-[20px] font-semibold tabular-nums" data-testid="free-left">{number(wallet.free_left)} <span className="text-[14px] font-normal text-muted">of {number(wallet.free_per_day)} left</span></p>
                  <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-line-2"><div className="h-full rounded-full bg-brand" style={{ width: `${freeShare}%` }} /></div>
                  <p className="mt-2 text-[13px] text-muted">For papers, full text and research tools. Back at midnight UTC.</p>
                </>
              ) : wallet ? (
                <p className="mt-1 text-[14px] text-ink-2">Confirm your email on the <Link href="/account" className="font-semibold text-brand hover:underline">account page</Link> to get {number(data?.wallet.free_per_day || 1000)} free credits a day.</p>
              ) : null}
            </div>
          </div>
          <div className="border-t border-line-2 px-5 py-4">
            <p className="mb-3 text-[13px] font-medium text-muted">Buy credits</p>
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {(data?.packs ?? []).map((pack) => (
                <button key={pack.id} type="button" disabled={!data?.payments_enabled || busy !== null} onClick={() => void buy(pack.id)}
                  className="flex flex-col items-start rounded-xl border border-line bg-white px-3.5 py-3 text-left transition-colors hover:border-brand hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60">
                  <span className="text-[15px] font-bold tabular-nums">{number(pack.credits)}<span className="ml-1 text-[12.5px] font-medium text-muted">credits</span></span>
                  <span className="mt-0.5 text-[14px] font-semibold text-ink-2">{usd(pack.cents)}</span>
                  <span className="text-[12.5px] text-muted">${pack.usd_per_1000.toFixed(2)} per 1,000</span>
                  {busy === `buy-${pack.id}` && <span className="mt-1 text-[12px] text-brand">Opening payment…</span>}
                </button>
              ))}
            </div>
            {data && !data.payments_enabled && <p className="mt-3 text-[13px] text-muted">Payments are not set up on this server yet.</p>}
          </div>
        </Card>

        {data?.topup && (
          <Card>
            <CardHeader title="Automatic top-up" description="Buy a pack with your saved card when the balance runs low." />
            <div className="flex flex-col gap-4 px-5 py-4">
              {(() => {
                const form = topup ?? data.topup!;
                const change = (patch: Partial<NonNullable<Overview['topup']>>) => setTopup({ ...form, ...patch });
                return (
                  <>
                    <label className="flex items-center gap-3 text-[14.5px] font-medium">
                      <input type="checkbox" className="size-[18px] accent-[var(--color-brand)]" checked={form.enabled} onChange={(event) => change({ enabled: event.target.checked })} />
                      Top up automatically
                    </label>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="text-[13px] font-medium text-muted">When below (credits)
                        <input className={`${inputClass} mt-1.5`} inputMode="numeric" value={form.threshold} onChange={(event) => change({ threshold: Number(event.target.value.replace(/\D/g, '')) || 0 })} />
                      </label>
                      <label className="text-[13px] font-medium text-muted">Buy
                        <select className={`${inputClass} mt-1.5`} value={form.pack} onChange={(event) => change({ pack: event.target.value })}>
                          {data.packs.map((pack) => <option key={pack.id} value={pack.id}>{number(pack.credits)} credits · {usd(pack.cents)}</option>)}
                        </select>
                      </label>
                      <label className="text-[13px] font-medium text-muted">At most per month ($)
                        <input className={`${inputClass} mt-1.5`} inputMode="decimal" value={form.monthly_limit_usd} onChange={(event) => change({ monthly_limit_usd: Number(event.target.value.replace(/[^\d.]/g, '')) || 0 })} />
                      </label>
                    </div>
                    {data.topup!.error && <p className="text-[13.5px] text-red-600">Last top-up failed: {data.topup!.error}</p>}
                    <div><Button variant="primary" size="sm" disabled={busy === 'topup' || !topup} onClick={() => void saveTopup()}>{busy === 'topup' ? 'Saving…' : 'Save'}</Button></div>
                  </>
                );
              })()}
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title="API keys" description="Send a key as a Bearer token. Use it in your own app or a self-hosted Videmak." />
          <div className="flex flex-wrap gap-2.5 px-5 pt-4">
            <input className={`${inputClass} max-w-xs flex-1`} placeholder="Key name, e.g. My app" value={keyName} maxLength={80} onChange={(event) => setKeyName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createKey(); }} />
            <Button variant="primary" disabled={busy === 'create'} onClick={() => void createKey()}><LuPlus size={16} />Create key</Button>
          </div>
          {newKey && (
            <div className="mx-5 mt-4 rounded-xl border border-line bg-panel p-3.5">
              <p className="text-[13px] font-medium">Copy this key now. It won&apos;t be shown again.</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-surface px-3 py-2 font-mono text-[12.5px] shadow-card" data-testid="new-key">{newKey}</code>
                <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(newKey); setCopied(true); }}>{copied ? <LuCheck size={15} /> : <LuCopy size={15} />}{copied ? 'Copied' : 'Copy'}</Button>
              </div>
            </div>
          )}
          {(data?.keys ?? []).length === 0 ? (
            <EmptyState title="No keys yet">{data?.starter_credits ? `Your first key comes with ${number(data.starter_credits)} credits to try AI.` : 'Create one to get started.'}</EmptyState>
          ) : (
            <div className="overflow-x-auto px-5 pb-2 pt-2">
              <table className="w-full min-w-[620px] text-left">
                <thead><tr className="text-[12px] text-muted"><th className="py-3 font-normal">Key</th><th className="py-3 font-normal">Name</th><th className="py-3 font-normal">This month</th><th className="py-3 font-normal">Monthly cap</th><th className="py-3 font-normal">Last used</th><th className="py-3" /></tr></thead>
                <tbody>
                  {data!.keys.map((key) => (
                    <tr key={key.id} className="h-12 border-t border-line-2 text-[13.5px]">
                      <td className="font-mono text-[12.5px]"><LuKeyRound size={13} className="mr-1.5 inline text-subtle" />{key.prefix}…</td>
                      <td>{key.name} {key.revoked_at ? <StatusPill>Revoked</StatusPill> : key.mode === 'test' ? <StatusPill tone="warning">Test</StatusPill> : null}</td>
                      <td className="tabular-nums text-ink-2">{credits(key.credits_this_month)}</td>
                      <td>
                        {capEdit?.id === key.id ? (
                          <span className="flex items-center gap-1.5">
                            <input autoFocus className="h-8 w-24 rounded-lg border border-line px-2 text-[13px]" inputMode="numeric" placeholder="None" value={capEdit.value} onChange={(event) => setCapEdit({ id: key.id, value: event.target.value.replace(/\D/g, '') })} onKeyDown={(event) => { if (event.key === 'Enter') void saveCap(); if (event.key === 'Escape') setCapEdit(null); }} />
                            <Button size="sm" onClick={() => void saveCap()}>Save</Button>
                          </span>
                        ) : (
                          <button type="button" disabled={Boolean(key.revoked_at)} className="text-ink-2 hover:text-brand disabled:text-subtle" onClick={() => setCapEdit({ id: key.id, value: key.monthly_credit_cap ? String(key.monthly_credit_cap) : '' })}>
                            {key.monthly_credit_cap ? `${number(key.monthly_credit_cap)} credits` : 'None'}
                          </button>
                        )}
                      </td>
                      <td className="text-muted">{key.last_used_at ? date(key.last_used_at) : 'Never'}</td>
                      <td className="text-right">{!key.revoked_at && <Button variant="ghost" size="sm" disabled={busy === `revoke-${key.id}`} onClick={() => void revoke(key.id)}>Revoke</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {activeKeys.length > 0 && (
            <div className="border-t border-line-2 px-5 py-3.5 text-[13px] text-muted">
              Try it: <code className="rounded bg-soft px-1.5 py-0.5 font-mono text-[12px] text-ink-2">curl -H &quot;Authorization: Bearer $VIDEMAK_API_KEY&quot; {typeof window === 'undefined' ? '' : window.location.origin}/v1/oa/works?search=sleep</code>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="This month" />
          {(data?.usage ?? []).length === 0 ? (
            <EmptyState title="Nothing used yet this month" />
          ) : (
            <div className="overflow-x-auto px-5">
              <table className="w-full min-w-[480px] text-left">
                <thead><tr className="text-[12px] text-muted"><th className="py-3 font-normal">Service</th><th className="py-3 font-normal">Calls</th><th className="py-3 text-right font-normal">Free</th><th className="py-3 text-right font-normal">Paid</th></tr></thead>
                <tbody>
                  {data!.usage.map((line) => (
                    <tr key={line.service} className="h-11 border-t border-line-2 text-[13.5px]">
                      <td>{line.label}</td>
                      <td className="tabular-nums text-muted">{number(line.calls)}</td>
                      <td className="text-right tabular-nums text-muted">{credits(line.free)}</td>
                      <td className="text-right tabular-nums">{credits(line.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {(data?.ledger ?? []).length > 0 && (
          <Card>
            <CardHeader title="Credits added" />
            <ul className="px-5 pb-2">
              {data!.ledger.map((entry, index) => (
                <li key={index} className="flex h-11 items-center gap-3 border-t border-line-2 text-[13.5px] first:border-t-0">
                  <LuZap size={14} className="text-brand" />
                  <span className="flex-1">{KIND[entry.kind] ?? entry.kind}</span>
                  <span className="text-muted">{date(entry.created_at)}</span>
                  <span className="w-24 text-right tabular-nums">+{credits(entry.credits)}</span>
                  <span className="w-20 text-right tabular-nums text-muted">{entry.amount_cents ? usd(entry.amount_cents) : '—'}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </AppFrame>
  );
}
