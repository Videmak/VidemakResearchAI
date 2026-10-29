'use client';

import { useCallback, useEffect, useState } from 'react';
import { LuCreditCard, LuDownload, LuExternalLink, LuPlus, LuTrash2, LuZap } from 'react-icons/lu';
import { Button, Card, CardHeader, EmptyState, StatusPill } from '@/components/app/ui';
import { api, refreshSession } from '@/lib/session';
import { money, openPricing, startCheckout, usePlans, type Interval } from '@/lib/billing';

type SavedCard = { id: string; brand: string; last4: string; exp_month: number; exp_year: number; name: string | null; funding: string | null; default: boolean };
type Invoice = {
  id: string; number: string | null; status: string | null; total: number; amount_due: number; currency: string; created: number;
  due_date: number | null; hosted_url: string | null; pdf: string | null; description: string | null; subscription: string | null;
};
type UsageRow = { key: string; label: string; used: number; limit: number | null; per: 'day' | 'month' };
export type Billing = {
  plan: { id: string; name: string; is_default: boolean };
  subscription: { plan_id: string | null; status: string; source: string; interval: string | null; period_end: string | null; cancel_at_period_end: boolean } | null;
  limits: { latex_export: boolean; library_pdfs: number | null };
  usage: UsageRow[];
  library: { used: number; limit: number | null };
  cards: SavedCard[];
  invoices: Invoice[];
  open_invoices: Invoice[];
  payments_enabled: boolean;
};

const LIVE = ['active', 'trialing', 'past_due'];
const day = (value: string | number) => new Date(typeof value === 'number' ? value * 1000 : value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const BRANDS: Record<string, { name: string; face: string }> = {
  visa: { name: 'VISA', face: 'from-[#1a3fa8] via-[#2350d4] to-[#3b82f6]' },
  mastercard: { name: 'mastercard', face: 'from-[#111827] via-[#1f2937] to-[#3f3f46]' },
  amex: { name: 'AMERICAN EXPRESS', face: 'from-[#0f766e] via-[#0e7490] to-[#38bdf8]' },
  discover: { name: 'DISCOVER', face: 'from-[#9a3412] via-[#ea580c] to-[#fb923c]' },
  jcb: { name: 'JCB', face: 'from-[#065f46] via-[#047857] to-[#10b981]' },
  unionpay: { name: 'UnionPay', face: 'from-[#7f1d1d] via-[#b91c1c] to-[#1e3a8a]' },
  diners: { name: 'Diners Club', face: 'from-[#334155] via-[#475569] to-[#94a3b8]' },
};
const CANCEL_REASONS = ['Too expensive', 'Not writing right now', 'Missing a feature', 'Switching tools', 'Other'];

/** Plan, usage, cards and invoices on the account page. */
export function BillingSection() {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const { plans } = usePlans();

  const load = useCallback(async () => {
    try { setBilling(await api<Billing>('/api/billing')); } catch (caught) { setError((caught as Error).message); }
  }, []);

  // Back from Stripe (a plan or a card), or straight from sign-up with a plan chosen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('billing');
    const session = params.get('session');
    const upgrade = params.get('upgrade');
    const clean = () => window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
    (async () => {
      if (outcome && session) {
        clean();
        setBusy('return');
        try {
          const done = await api<{ kind: string }>('/api/billing/checkout/complete', { method: 'POST', body: JSON.stringify({ session }) });
          setNotice(done.kind === 'card' ? 'Card added.' : done.kind === 'subscription' ? 'Payment received. Your new plan is on.' : null);
          await refreshSession().catch(() => undefined);
        } catch (caught) { setError((caught as Error).message); }
        setBusy(null);
      } else if (outcome === 'cancelled') {
        clean();
        setNotice('Checkout cancelled. Nothing was charged.');
      } else if (upgrade) {
        clean();
        setBusy('return');
        try {
          await startCheckout(upgrade, params.get('interval') === 'month' ? 'month' : 'year');
          return;
        } catch (caught) { setError((caught as Error).message); }
        setBusy(null);
      }
      await load();
    })();
  }, [load]);

  const run = async (key: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(key); setError(null); setNotice(null);
    try {
      await work();
      if (done) setNotice(done);
      await Promise.all([load(), refreshSession().catch(() => undefined)]);
    } catch (caught) { setError((caught as Error).message); }
    setBusy(null);
  };
  const go = async (key: string, path: string, body?: unknown) => run(key, async () => {
    const result = await api<{ url?: string; renewed?: boolean; paid?: boolean; hosted_url?: string | null; error?: string }>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
    if (result.url) { window.location.assign(result.url); await new Promise(() => {}); }
    if (result.paid === false) {
      if (result.hosted_url) { window.location.assign(result.hosted_url); await new Promise(() => {}); }
      throw new Error(result.error || 'The payment did not go through.');
    }
  });

  if (!billing) {
    return (
      <Card><div className="flex h-40 items-center justify-center text-[14px] text-muted" aria-busy="true">{error || (busy === 'return' ? 'Finishing up with Stripe…' : 'Loading billing…')}</div></Card>
    );
  }

  const sub = billing.subscription;
  const paying = Boolean(sub && sub.source === 'stripe' && LIVE.includes(sub.status));
  const lapsed = Boolean(sub && sub.source === 'stripe' && sub.plan_id && !LIVE.includes(sub.status) && sub.status !== 'none');
  const lapsedPlan = lapsed ? plans?.find((plan) => plan.id === sub!.plan_id) : null;
  const shown = plans?.find((plan) => plan.id === billing.plan.id);
  const interval: Interval = sub?.interval === 'year' ? 'year' : 'month';
  const price = shown && paying ? (interval === 'year' ? `${money(shown.yearly_cents, shown.currency)} / year` : `${money(shown.monthly_cents, shown.currency)} / month`) : null;
  const status = !sub || sub.source === 'default' || (!paying && !lapsed && sub.source !== 'admin')
    ? null
    : sub.source === 'admin' ? { tone: 'brand' as const, label: 'Given by Videmak' }
    : sub.status === 'past_due' ? { tone: 'negative' as const, label: 'Payment failed' }
    : sub.status === 'trialing' ? { tone: 'brand' as const, label: 'Trial' }
    : sub.cancel_at_period_end ? { tone: 'warning' as const, label: 'Cancelled' }
    : paying ? { tone: 'positive' as const, label: 'Active' } : null;
  const periodLine = paying && sub?.period_end
    ? sub.cancel_at_period_end ? `Ends ${day(sub.period_end)}, then Free` : `${sub.status === 'trialing' ? 'Trial ends' : 'Renews'} ${day(sub.period_end)}`
    : null;
  const openInvoices = billing.open_invoices;

  return (
    <div className="flex flex-col gap-5">
      {(notice || error) && (
        <p role={error ? 'alert' : 'status'} className={`rounded-xl px-4 py-3 text-[14px] ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>{error || notice}</p>
      )}

      <Card>
        <div id="plan" className="flex flex-wrap items-start gap-4 px-5 py-5">
          <div className="min-w-[220px] flex-1">
            <p className="text-[13px] font-medium text-muted">Your plan</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-[24px] font-bold tracking-[-0.02em]">{billing.plan.name}</h2>
              {status && <StatusPill tone={status.tone}>{status.label}</StatusPill>}
            </div>
            {(price || periodLine) && <p className="mt-1 text-[14px] text-muted">{[price, periodLine].filter(Boolean).join(' · ')}</p>}
            {lapsed && (
              <p className="mt-1 text-[14px] text-muted">Your {lapsedPlan?.name || 'paid'} plan ended{sub?.period_end ? ` on ${day(sub.period_end)}` : ''}.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {lapsed && billing.payments_enabled && (
              <Button variant="primary" disabled={busy !== null} onClick={() => void go('renew', '/api/billing/renew')}>
                {busy === 'renew' ? 'Renewing…' : `Renew ${lapsedPlan?.name || 'plan'}`}
              </Button>
            )}
            {paying && sub?.cancel_at_period_end && (
              <Button variant="primary" disabled={busy !== null} onClick={() => void run('resume', () => api('/api/billing/resume', { method: 'POST' }), 'Your plan will renew as usual.')}>
                {busy === 'resume' ? 'Resuming…' : 'Keep my plan'}
              </Button>
            )}
            <Button variant={paying || lapsed ? 'secondary' : 'primary'} onClick={() => openPricing()}>
              {!paying && !lapsed && <LuZap className="h-4 w-4" aria-hidden="true" />}
              {paying ? 'Change plan' : 'Upgrade'}
            </Button>
            {paying && !sub?.cancel_at_period_end && (
              <Button variant="ghost" onClick={() => setCancelling(true)}>Cancel plan</Button>
            )}
          </div>
        </div>

        {sub?.status === 'past_due' && openInvoices.length > 0 && (
          <div className="mx-5 mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="min-w-0 flex-1 text-[14px] text-red-800">Your last payment failed. Pay now to keep {billing.plan.name}.</p>
            <Button variant="primary" size="sm" disabled={busy !== null} onClick={() => void go(`pay-${openInvoices[0].id}`, `/api/billing/invoices/${openInvoices[0].id}/pay`)}>
              {busy === `pay-${openInvoices[0].id}` ? 'Paying…' : `Pay ${money(openInvoices[0].amount_due, openInvoices[0].currency, true)}`}
            </Button>
          </div>
        )}

        {cancelling && (
          <div className="mx-5 mb-5 rounded-xl border border-line bg-soft p-4">
            <p className="text-[15px] font-semibold">Cancel {billing.plan.name}?</p>
            <p className="mt-1 text-[14px] text-muted">You keep it until {sub?.period_end ? day(sub.period_end) : 'the end of this period'}, then move to Free.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {CANCEL_REASONS.map((item) => (
                <button key={item} type="button" aria-pressed={reason === item} onClick={() => setReason(item)}
                  className={`h-[30px] rounded-full border px-3 text-[13px] font-medium ${reason === item ? 'border-brand-100 bg-brand-50 text-brand-600' : 'border-line bg-white text-ink-2'}`}>
                  {item}
                </button>
              ))}
            </div>
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} maxLength={400} placeholder="Anything we could do better? (optional)"
              className="mt-3 w-full rounded-xl border border-line bg-white px-3 py-2 text-[14px] focus:border-brand focus:outline-none" />
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCancelling(false)}>Keep plan</Button>
              <Button variant="danger" size="sm" disabled={busy !== null} onClick={() => void run('cancel', async () => {
                await api('/api/billing/cancel', { method: 'POST', body: JSON.stringify({ reason: [reason, comment.trim()].filter(Boolean).join(': ') || undefined }) });
                setCancelling(false);
              }, 'Your plan is cancelled and ends at the end of this period.')}>
                {busy === 'cancel' ? 'Cancelling…' : 'Cancel plan'}
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-x-8 gap-y-4 border-t border-line-2 px-5 py-5 sm:grid-cols-2">
          {billing.usage.map((row) => <Meter key={row.key} label={row.label} used={row.used} limit={row.limit} per={row.per} />)}
          <Meter label="PDFs in Library" used={billing.library.used} limit={billing.library.limit} />
          <div className="flex items-center justify-between text-[14px]">
            <span className="text-ink-2">LaTeX export</span>
            {billing.limits.latex_export ? <StatusPill tone="positive">Included</StatusPill> : <StatusPill>Paid plans</StatusPill>}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Payment methods" />
        {!billing.payments_enabled ? (
          <EmptyState title="Payments are not set up yet" />
        ) : (
          <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
            {billing.cards.map((card) => (
              <div key={card.id} className="flex max-w-[380px] flex-col gap-2.5">
                <BankCard card={card} />
                <div className="flex min-h-9 flex-wrap items-center gap-1">
                  {removing === card.id ? (
                    <>
                      <span className="mr-auto text-[13.5px] text-ink-2">Remove this card?</span>
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>No</Button>
                      <Button variant="danger" size="sm" disabled={busy !== null} onClick={() => void run(`remove-${card.id}`, async () => {
                        await api(`/api/billing/cards/${card.id}`, { method: 'DELETE' });
                        setRemoving(null);
                      }, 'Card removed.')}>{busy === `remove-${card.id}` ? 'Removing…' : 'Remove'}</Button>
                    </>
                  ) : (
                    <>
                      {card.default
                        ? <span className="mr-auto text-[13.5px] font-medium text-muted">Default card</span>
                        : <Button variant="ghost" size="sm" className="mr-auto" disabled={busy !== null} onClick={() => void run(`default-${card.id}`, () => api(`/api/billing/cards/${card.id}/default`, { method: 'POST' }), 'Default card changed.')}>
                            {busy === `default-${card.id}` ? 'Saving…' : 'Make default'}
                          </Button>}
                      <Button variant="ghost" size="sm" aria-label={`Remove card ending ${card.last4}`} onClick={() => setRemoving(card.id)}><LuTrash2 className="h-4 w-4" /></Button>
                    </>
                  )}
                </div>
              </div>
            ))}
            <button type="button" disabled={busy !== null} onClick={() => void go('add-card', '/api/billing/cards')}
              className="flex aspect-[1.586] w-full max-w-[380px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line text-[14.5px] font-semibold text-ink-2 hover:border-brand hover:text-brand disabled:opacity-60">
              <LuPlus className="h-6 w-6" aria-hidden="true" />
              {busy === 'add-card' ? 'Opening Stripe…' : 'Add card'}
            </button>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Invoices" />
        {billing.invoices.length === 0 ? (
          <EmptyState title="No invoices yet" />
        ) : (
          <div className="overflow-x-auto px-5 pb-2">
            <table className="w-full min-w-[560px] text-left">
              <thead><tr className="text-[12px] text-muted"><th className="py-3 font-normal">Date</th><th className="py-3 font-normal">Invoice</th><th className="py-3 font-normal">Amount</th><th className="py-3 font-normal">Status</th><th className="py-3" /></tr></thead>
              <tbody>
                {billing.invoices.map((invoice) => (
                  <tr key={invoice.id} className="h-12 border-t border-line-2 text-[13.5px]">
                    <td className="whitespace-nowrap text-muted">{day(invoice.created)}</td>
                    <td className="max-w-[220px] truncate pr-3">{invoice.number || invoice.description || 'Invoice'}</td>
                    <td className="tabular-nums">{money(invoice.status === 'open' ? invoice.amount_due : invoice.total, invoice.currency, true)}</td>
                    <td><InvoiceStatus status={invoice.status} /></td>
                    <td className="whitespace-nowrap text-right">
                      {invoice.status === 'open' && (
                        <Button variant="primary" size="sm" disabled={busy !== null} onClick={() => void go(`pay-${invoice.id}`, `/api/billing/invoices/${invoice.id}/pay`)}>
                          {busy === `pay-${invoice.id}` ? 'Paying…' : 'Pay now'}
                        </Button>
                      )}
                      {invoice.status !== 'open' && invoice.pdf && (
                        <a href={invoice.pdf} target="_blank" rel="noreferrer" aria-label="Download invoice PDF" className="inline-grid h-9 w-9 place-items-center rounded-[10px] text-muted hover:bg-soft hover:text-ink"><LuDownload className="h-4 w-4" /></a>
                      )}
                      {invoice.hosted_url && (
                        <a href={invoice.hosted_url} target="_blank" rel="noreferrer" aria-label="Open invoice on Stripe" className="inline-grid h-9 w-9 place-items-center rounded-[10px] text-muted hover:bg-soft hover:text-ink"><LuExternalLink className="h-4 w-4" /></a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function InvoiceStatus({ status }: { status: string | null }) {
  if (status === 'paid') return <StatusPill tone="positive">Paid</StatusPill>;
  if (status === 'open') return <StatusPill tone="negative">Due</StatusPill>;
  if (status === 'void') return <StatusPill>Void</StatusPill>;
  if (status === 'uncollectible') return <StatusPill tone="warning">Unpaid</StatusPill>;
  return <StatusPill>{status || '—'}</StatusPill>;
}

function Meter({ label, used, limit, per }: { label: string; used: number; limit: number | null; per?: 'day' | 'month' }) {
  const share = limit === null ? 0 : limit === 0 ? 1 : Math.min(1, used / limit);
  const full = limit !== null && used >= limit;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[14px]">
        <span className="text-ink-2">{label}</span>
        <span className={`tabular-nums ${full ? 'font-semibold text-red-600' : 'text-muted'}`}>
          {limit === null ? 'Unlimited' : limit === 0 ? 'Paid plans' : `${used.toLocaleString('en-US')} / ${limit.toLocaleString('en-US')}${per ? ` ${per === 'day' ? 'today' : 'this month'}` : ''}`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line-2">
        <div className={`h-full rounded-full ${full ? 'bg-red-500' : 'bg-brand'}`} style={{ width: limit === null ? '100%' : `${Math.max(share * 100, used > 0 ? 3 : 0)}%`, opacity: limit === null ? 0.25 : 1 }} />
      </div>
    </div>
  );
}

/** A saved card drawn like the real thing: brand colours, chip, number, holder and expiry. */
function BankCard({ card }: { card: SavedCard }) {
  const brand = BRANDS[card.brand] ?? { name: card.brand.toUpperCase(), face: 'from-[#334155] via-[#475569] to-[#64748b]' };
  return (
    <div className={`relative flex aspect-[1.586] w-full flex-col overflow-hidden rounded-2xl bg-gradient-to-br p-5 text-white shadow-[0_18px_40px_-20px_rgba(15,23,42,.6)] ${brand.face}`}>
      <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-white/10" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-20 -left-8 h-44 w-44 rounded-full bg-white/[.07]" aria-hidden="true" />
      <div className="relative flex items-start justify-between">
        <span className="h-8 w-11 rounded-md bg-gradient-to-br from-[#fde68a] via-[#fbbf24] to-[#d97706] shadow-inner" aria-hidden="true">
          <span className="block h-full w-full rounded-md bg-[repeating-linear-gradient(90deg,transparent_0_9px,rgba(120,53,15,.35)_9px_10px)]" />
        </span>
        {card.default && <span className="rounded-full bg-white/20 px-2.5 py-1 text-[11.5px] font-semibold backdrop-blur">Default</span>}
      </div>
      <p className="relative mt-auto font-mono text-[17px] tracking-[0.14em] sm:text-[18px]" aria-label={`Card ending ${card.last4}`}>•••• •••• •••• {card.last4}</p>
      <div className="relative mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.12em] text-white/60">{card.name ? 'Card holder' : 'Expires'}</p>
          <p className="truncate text-[13.5px] font-medium">{card.name || `${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)}`}</p>
        </div>
        {card.name && (
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/60">Expires</p>
            <p className="text-[13.5px] font-medium">{String(card.exp_month).padStart(2, '0')}/{String(card.exp_year).slice(-2)}</p>
          </div>
        )}
        <span className={`shrink-0 font-bold italic ${card.brand === 'mastercard' ? 'flex items-center' : 'text-[19px] tracking-[0.04em]'}`}>
          {card.brand === 'mastercard'
            ? (<><span className="h-7 w-7 rounded-full bg-[#eb001b]" /><span className="-ml-3 h-7 w-7 rounded-full bg-[#f79e1b]/90" /></>)
            : card.brand === 'card' ? <LuCreditCard className="h-6 w-6" aria-hidden="true" /> : brand.name}
        </span>
      </div>
    </div>
  );
}
