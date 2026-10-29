'use client';

import { useCallback, useMemo, useState } from 'react';
import { LuGift, LuLayers, LuPencil, LuPlus, LuSearch, LuUsers } from 'react-icons/lu';
import { Button, Card, CardHeader, EmptyState, StatusPill, inputClass } from '@/components/app/ui';
import { api } from '@/lib/session';
import { PlanEditor } from './PlanEditor';
import { SectionHeader } from './SettingsSection';
import { words, type Notice } from './adminTypes';
import { money, stripeState, type AdminPlan, type PlansResponse, type Subscriber } from './planTypes';

const STATUS_TONE: Record<string, 'positive' | 'warning' | 'negative' | 'neutral'> = {
  active: 'positive', trialing: 'positive', past_due: 'warning', unpaid: 'negative', canceled: 'negative', incomplete: 'warning', incomplete_expired: 'negative', paused: 'neutral',
};
const SOURCE: Record<string, string> = { stripe: 'Stripe', admin: 'Given', default: '—' };
const date = (value: string | null) => (value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

function price(plan: AdminPlan) {
  if (plan.checkout === 'contact') return { main: 'Custom', note: 'Talk to us' };
  if (!plan.monthly_cents && !plan.yearly_cents) return { main: money(0, plan.currency), note: 'Free forever' };
  return {
    main: plan.monthly_cents ? `${money(plan.monthly_cents, plan.currency)}` : `${money(plan.yearly_cents, plan.currency)}`,
    note: plan.monthly_cents ? `/ month${plan.yearly_cents ? ` · ${money(plan.yearly_cents, plan.currency)} / year` : ''}` : '/ year',
  };
}

type Shared = { data: PlansResponse | null; reload: () => Promise<void>; notify: (notice: Notice) => void };

/** Admin › Plans: one card per plan; a card opens the editor. */
export function PlansSection({ data, reload, notify }: Shared) {
  const [editing, setEditing] = useState<AdminPlan | 'new' | null>(null);
  const closeEditor = useCallback(() => setEditing(null), []);
  const saved = useCallback((text: string, problem?: boolean) => {
    setEditing(null);
    notify({ tone: problem ? 'error' : 'ok', text });
    void reload();
  }, [notify, reload]);
  const plans = data?.plans ?? [];

  return (
    <section>
      <SectionHeader icon={LuLayers} title="Plans" subtitle={data && !data.stripe_ready ? 'Stripe is not set up: paid plans can’t be bought yet.' : 'What people can buy, and what each plan allows.'}
        actions={<Button variant="primary" size="sm" onClick={() => setEditing('new')} disabled={!data}><LuPlus size={15} />New plan</Button>} />
      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map((index) => <div key={index} className="h-[152px] animate-pulse rounded-2xl bg-line-2" />)}</div>
      ) : plans.length === 0 ? (
        <Card><EmptyState title="No plans yet" action={<Button variant="primary" onClick={() => setEditing('new')}>New plan</Button>} /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {plans.map((plan) => {
            const stripe = stripeState(plan);
            const cost = price(plan);
            return (
              <button key={plan.id} type="button" onClick={() => setEditing(plan)}
                className={`group flex flex-col rounded-2xl border bg-white p-5 text-left transition-shadow hover:shadow-[0_10px_30px_-18px_rgba(15,23,42,.45)] ${plan.featured ? 'border-brand/50' : 'border-line'}`}>
                <div className="flex w-full items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-2"><span className="text-[16px] font-bold">{plan.name}</span><span className="font-mono text-[12px] text-subtle">{plan.id}</span></p>
                    <p className="mt-0.5 truncate text-[13px] text-muted">{plan.tagline || '—'}</p>
                  </div>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-subtle group-hover:bg-soft group-hover:text-ink"><LuPencil size={15} /></span>
                </div>
                <p className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-[26px] font-bold tracking-[-0.02em]">{cost.main}</span>
                  <span className="text-[13px] text-muted">{cost.note}</span>
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex h-[22px] items-center gap-1 rounded-md bg-line-2 px-2 text-[11.5px] font-semibold tabular-nums text-ink-2"><LuUsers size={12} />{plan.subscribers}</span>
                  {plan.is_default && <StatusPill tone="brand">Default</StatusPill>}
                  {plan.featured && <StatusPill tone="brand">Most popular</StatusPill>}
                  {!plan.is_public && <StatusPill>Hidden</StatusPill>}
                  {plan.trial_days > 0 && <StatusPill>{plan.trial_days}-day trial</StatusPill>}
                  <StatusPill tone={stripe.tone}>{stripe.label}</StatusPill>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {editing && data && (
        <PlanEditor
          plan={editing === 'new' ? null : editing}
          defs={data.limit_defs}
          nextSort={plans.reduce((max, plan) => Math.max(max, plan.sort_order + 1), 0)}
          onClose={closeEditor}
          onSaved={saved}
        />
      )}
    </section>
  );
}

/** Admin › Subscribers: who is on which plan, and giving a plan by email. */
export function SubscribersSection({ data, subscribers, reload, notify }: Shared & { subscribers: Subscriber[] | null }) {
  const [give, setGive] = useState({ email: '', plan: '' });
  const [giving, setGiving] = useState(false);
  const [query, setQuery] = useState('');
  const plans = data?.plans ?? [];
  const planName = (id: string | null) => plans.find((plan) => plan.id === id)?.name ?? id ?? '—';
  const shown = useMemo(() => (subscribers ?? []).filter((person) => person.email.toLowerCase().includes(query.trim().toLowerCase())), [subscribers, query]);

  const givePlan = async () => {
    if (!give.email.trim() || !give.plan) { notify({ tone: 'error', text: 'Enter an email and choose a plan.' }); return; }
    setGiving(true); notify(null);
    try {
      const plan = give.plan === '__none' ? null : give.plan;
      await api('/api/admin/accounts/plan', { method: 'PUT', body: JSON.stringify({ email: give.email.trim(), plan }) });
      notify({ tone: 'ok', text: plan ? `${give.email.trim()} is now on ${planName(plan)}.` : `Removed the given plan from ${give.email.trim()}.` });
      setGive({ email: '', plan: '' });
      await reload();
    } catch (caught) { notify({ tone: 'error', text: (caught as Error).message }); } finally { setGiving(false); }
  };

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader icon={LuUsers} title="Subscribers" subtitle="Paying accounts and plans given by an admin." />

      <Card>
        <CardHeader title="Give a plan" />
        <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row">
          <input type="email" aria-label="Email" placeholder="name@example.com" autoComplete="off" value={give.email} onChange={(event) => setGive({ ...give, email: event.target.value })} className={`${inputClass} h-10 text-[14px] sm:flex-1`} />
          <select aria-label="Plan" value={give.plan} onChange={(event) => setGive({ ...give, plan: event.target.value })} className={`${inputClass} h-10 text-[14px] sm:w-[200px]`}>
            <option value="">Choose a plan</option>
            {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            <option value="__none">Remove given plan</option>
          </select>
          <Button variant="primary" onClick={() => void givePlan()} disabled={giving} className="h-10"><LuGift size={15} />{giving ? 'Saving…' : 'Give'}</Button>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line-2 px-5 py-3.5">
          <h3 className="flex-1 text-[16px] font-bold">{subscribers ? `${subscribers.length} ${subscribers.length === 1 ? 'account' : 'accounts'}` : 'Accounts'}</h3>
          <label className="relative w-full sm:w-[240px]">
            <LuSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <input type="search" aria-label="Search by email" placeholder="Search by email" value={query} onChange={(event) => setQuery(event.target.value)}
              className="h-9 w-full rounded-[10px] border border-line bg-white pl-9 pr-3 text-[14px] placeholder:text-subtle focus:border-brand focus:outline-none" />
          </label>
        </div>
        {!subscribers ? (
          <p className="px-5 py-6 text-[13.5px] text-muted">Loading…</p>
        ) : shown.length === 0 ? (
          <EmptyState title={subscribers.length ? 'No match' : 'No subscribers yet'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left">
              <thead>
                <tr className="bg-soft text-[12px] text-muted">
                  <th className="px-5 py-2.5 font-medium">Email</th><th className="py-2.5 pr-3 font-medium">Plan</th><th className="py-2.5 pr-3 font-medium">Status</th>
                  <th className="py-2.5 pr-3 font-medium">Source</th><th className="py-2.5 pr-3 font-medium">Billing</th><th className="py-2.5 pr-5 font-medium">Renews / ends</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((person) => (
                  <tr key={`${person.email}-${person.plan}`} className="h-12 border-t border-line-2 text-[13.5px]">
                    <td className="max-w-[260px] truncate px-5">{person.email}</td>
                    <td className="pr-3 font-medium">{planName(person.plan)}</td>
                    <td className="pr-3"><StatusPill tone={STATUS_TONE[person.plan_status] ?? 'neutral'}>{words(person.plan_status || 'none')}</StatusPill></td>
                    <td className="pr-3 text-muted">{SOURCE[person.plan_source] ?? person.plan_source}</td>
                    <td className="pr-3 text-muted">{person.plan_interval === 'year' ? 'Yearly' : person.plan_interval === 'month' ? 'Monthly' : '—'}</td>
                    <td className="whitespace-nowrap pr-5 text-muted">
                      {date(person.plan_period_end)}
                      {person.plan_cancel_at_period_end && <span className="ml-1.5"><StatusPill tone="warning">Ends</StatusPill></span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}
