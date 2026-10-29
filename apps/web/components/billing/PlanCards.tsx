'use client';

import { LuCheck, LuMinus } from 'react-icons/lu';
import { priceOf, type Interval, type PublicPlan } from '@/lib/billing';

/** What a plan card's button does; the dialog and /pricing decide it. */
export type PlanAction =
  | { kind: 'button'; label: string; primary?: boolean; busy?: boolean; onClick: () => void }
  | { kind: 'link'; label: string; primary?: boolean; href: string }
  | { kind: 'disabled'; label: string };

const button = (primary?: boolean) =>
  `inline-flex h-11 w-full items-center justify-center gap-2 rounded-[11px] text-[15px] font-semibold transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
    primary ? 'bg-brand text-white shadow-brand hover:bg-brand-600 disabled:opacity-70' : 'border border-line bg-white text-ink hover:bg-soft disabled:text-subtle'
  }`;

function Action({ action }: { action: PlanAction }) {
  if (action.kind === 'link') return <a href={action.href} className={button(action.primary)}>{action.label}</a>;
  if (action.kind === 'disabled') return <button type="button" disabled className={`${button(false)} cursor-default bg-soft`}>{action.label}</button>;
  return (
    <button type="button" onClick={action.onClick} disabled={action.busy} className={button(action.primary)}>
      {action.busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />}
      {action.label}
    </button>
  );
}

/** The plan cards, as on the approved pricing mockup. */
export function PlanCards({ plans, interval, actionFor, currentId, compact = false }: {
  plans: PublicPlan[]; interval: Interval; actionFor: (plan: PublicPlan) => PlanAction; currentId?: string | null; compact?: boolean;
}) {
  const columns = plans.length >= 4 ? 'md:grid-cols-2 xl:grid-cols-4' : plans.length === 3 ? 'lg:grid-cols-3' : 'md:grid-cols-2';
  return (
    <div className={`grid items-stretch gap-5 ${columns}`}>
      {plans.map((plan) => {
        const price = priceOf(plan, interval);
        const current = plan.id === currentId;
        return (
          <section key={plan.id} aria-labelledby={`plan-${plan.id}`}
            className={`relative flex flex-col rounded-[20px] bg-white ${compact ? 'p-5' : 'p-6 sm:p-7'} ${
              plan.featured ? 'border-2 border-brand shadow-[0_30px_60px_-30px_rgba(37,99,235,.45)]' : 'border border-line'}`}>
            {(plan.featured || current) && (
              <p className={`absolute -top-3 left-5 rounded-full px-2.5 py-1 text-[12px] font-bold ${current ? 'bg-ink text-white' : 'bg-brand text-white'}`}>
                {current ? 'Your plan' : 'Most popular'}
              </p>
            )}
            <h3 id={`plan-${plan.id}`} className="text-[19px] font-bold text-ink">{plan.name}</h3>
            <p className="mt-1 min-h-[40px] text-[14px] leading-snug text-muted">{plan.tagline}</p>
            <p className="mt-4 flex items-baseline gap-1.5">
              <span className={`${compact ? 'text-[38px]' : 'text-[46px]'} font-bold leading-[1.15] tracking-[-0.03em] text-ink`}>{price.amount}</span>
              {price.unit && <span className="text-[15px] text-muted">{price.unit}</span>}
            </p>
            <p className="min-h-5 text-[13px] text-muted">{price.note}</p>
            {plan.trial_days > 0 && plan.purchasable && <p className="mt-1 text-[13px] font-semibold text-green-700">{plan.trial_days}-day free trial</p>}
            <div className="mb-5 mt-5"><Action action={actionFor(plan)} /></div>
            <ul className="flex flex-col gap-2.5">
              {plan.features.map((feature) => (
                <li key={feature.label} className={`flex gap-2.5 text-[14.5px] leading-[1.45] ${feature.included ? 'text-ink-2' : 'text-subtle'}`}>
                  {feature.included
                    ? <LuCheck className="mt-[3px] h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                    : <LuMinus className="mt-[3px] h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />}
                  <span>{!feature.included && <span className="sr-only">Not included: </span>}{feature.label}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Monthly / Yearly switch with the yearly saving. */
export function IntervalToggle({ value, onChange, saving }: { value: Interval; onChange: (value: Interval) => void; saving: number }) {
  const option = (id: Interval, label: string) => (
    <button type="button" aria-pressed={value === id} onClick={() => onChange(id)}
      className={`flex h-9 items-center gap-2 rounded-[9px] px-4 text-[14.5px] font-semibold transition-colors ${value === id ? 'bg-white text-ink shadow-[0_1px_3px_rgba(15,23,42,.12)]' : 'text-muted hover:text-ink'}`}>
      {label}
      {id === 'year' && saving > 0 && <span className="rounded-[7px] bg-green-100 px-2 py-0.5 text-[12.5px] font-semibold text-green-700">Save {saving}%</span>}
    </button>
  );
  return (
    <div role="group" aria-label="Billing period" className="inline-flex rounded-xl bg-line-2 p-1">
      {option('month', 'Monthly')}
      {option('year', 'Yearly')}
    </div>
  );
}
