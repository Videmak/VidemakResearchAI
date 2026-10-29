'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, refreshSession, useSession } from '@/lib/session';
import { startCheckout, type Interval, type PublicPlan } from '@/lib/billing';
import type { PlanAction } from './PlanCards';

type Current = { planId: string; interval: string | null; paying: boolean; source: string } | null;
const LIVE = ['active', 'trialing', 'past_due'];

/** Which plan the person is on, and what each plan card's button does for them. */
export function usePlanChoice(interval: Interval, onChanged?: (plan: PublicPlan) => void) {
  const { user } = useSession();
  const [current, setCurrent] = useState<Current>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) { setCurrent(null); return; }
    try {
      const billing = await api<{ plan: { id: string }; subscription: { status: string; source: string; interval: string | null } | null }>('/api/billing');
      const sub = billing.subscription;
      const paying = Boolean(sub && sub.source === 'stripe' && LIVE.includes(sub.status));
      setCurrent({ planId: billing.plan.id, interval: paying ? sub!.interval : null, paying, source: sub?.source ?? 'default' });
    } catch {
      setCurrent(user.plan ? { planId: user.plan, interval: null, paying: false, source: 'default' } : null);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const choose = async (plan: PublicPlan, chosen: Interval) => {
    setBusy(plan.id);
    setError(null);
    try {
      const result = await startCheckout(plan.id, chosen);
      if (result === 'changed') {
        await Promise.all([refreshSession().catch(() => undefined), load()]);
        onChanged?.(plan);
        setBusy(null);
      }
      // 'redirected': Stripe's page is loading; keep the spinner.
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(null);
    }
  };

  const actionFor = (plan: PublicPlan): PlanAction => {
    if (plan.checkout === 'contact') return { kind: 'link', label: 'Talk to us', href: plan.contact_url || '/pricing' };
    if (!user) {
      if (plan.is_default) return { kind: 'link', label: 'Start writing', href: '/signup' };
      if (!plan.purchasable) return { kind: 'disabled', label: 'Coming soon' };
      return { kind: 'link', label: `Get ${plan.name}`, primary: plan.featured, href: `/signup?plan=${plan.id}&interval=${interval}` };
    }
    const mine = current?.planId === plan.id;
    if (plan.is_default) {
      if (mine) return { kind: 'disabled', label: 'Your plan' };
      return current?.paying ? { kind: 'link', label: 'Downgrade', href: '/account#plan' } : { kind: 'disabled', label: 'Free' };
    }
    if (!plan.purchasable) return mine ? { kind: 'disabled', label: 'Your plan' } : { kind: 'disabled', label: 'Coming soon' };
    if (interval === 'year' && !plan.has_yearly) return { kind: 'disabled', label: 'Monthly only' };
    if (interval === 'month' && !plan.has_monthly) return { kind: 'disabled', label: 'Yearly only' };
    if (mine && (!current?.paying || current.interval === interval)) return { kind: 'disabled', label: 'Your plan' };
    const label = mine ? `Switch to ${interval === 'year' ? 'yearly' : 'monthly'}` : current?.paying ? `Switch to ${plan.name}` : `Upgrade to ${plan.name}`;
    return { kind: 'button', label, primary: plan.featured || !current?.paying, busy: busy === plan.id, onClick: () => void choose(plan, interval) };
  };

  return { actionFor, currentId: current?.planId ?? null, error, reload: load };
}
