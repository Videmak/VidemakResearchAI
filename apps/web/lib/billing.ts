'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '@/lib/session';

/** Plans, prices and the pricing dialog, shared by the app, the account page and /pricing. */

export type Interval = 'month' | 'year';
export type CountLimit = { amount: number | null; per: 'day' | 'month' };
export type PlanLimits = {
  autocomplete: CountLimit; ai_edit: CountLimit; chat: CountLimit; review: CountLimit; write: CountLimit;
  library_pdfs: number | null; latex_export: boolean;
};
export type PublicPlan = {
  id: string; name: string; tagline: string; featured: boolean; is_default: boolean; checkout: 'self_serve' | 'contact';
  contact_url: string | null; monthly_cents: number; yearly_cents: number; currency: string; trial_days: number;
  limits: PlanLimits; features: { label: string; included: boolean }[];
  purchasable: boolean; has_monthly: boolean; has_yearly: boolean;
};

export function money(cents: number, currency = 'usd', exact = false) {
  const whole = cents % 100 === 0 && !exact;
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

/** The big price, its unit and the line under it, for a billing interval. */
export function priceOf(plan: PublicPlan, interval: Interval): { amount: string; unit: string; note: string } {
  if (plan.checkout === 'contact') return { amount: 'Custom', unit: '', note: 'Volume pricing for groups' };
  if (plan.monthly_cents === 0 && plan.yearly_cents === 0) return { amount: money(0, plan.currency), unit: 'forever', note: '' };
  if (interval === 'year' && plan.yearly_cents > 0) {
    return {
      amount: money(Math.round(plan.yearly_cents / 12), plan.currency), unit: '/ month',
      note: `${money(plan.yearly_cents, plan.currency)} billed yearly`,
    };
  }
  return { amount: money(plan.monthly_cents, plan.currency), unit: '/ month', note: 'Billed monthly' };
}

/** The best yearly saving across paid plans, for the "Save N%" badge. */
export function yearlySaving(plans: PublicPlan[]) {
  const savings = plans
    .filter((plan) => plan.monthly_cents > 0 && plan.yearly_cents > 0)
    .map((plan) => Math.round((1 - plan.yearly_cents / (plan.monthly_cents * 12)) * 100));
  return savings.length ? Math.max(...savings) : 0;
}

let plansRequest: Promise<PublicPlan[]> | null = null;
export function fetchPlans(fresh = false) {
  if (!plansRequest || fresh) {
    plansRequest = api<{ plans: PublicPlan[] }>('/api/plans').then((result) => result.plans);
    plansRequest.catch(() => { plansRequest = null; });
  }
  return plansRequest;
}

export function usePlans(initial?: PublicPlan[]) {
  const [plans, setPlans] = useState<PublicPlan[] | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchPlans().then((list) => { if (live) setPlans(list); }).catch((caught) => { if (live) setError((caught as Error).message); });
    return () => { live = false; };
  }, []);
  return { plans, error };
}

/** Starts (or switches) a plan: Stripe Checkout for a new subscription, an in-place change otherwise. */
export async function startCheckout(plan: string, interval: Interval): Promise<'redirected' | 'changed'> {
  const result = await api<{ url?: string; changed?: boolean }>('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan, interval }) });
  if (result.url) {
    window.location.assign(result.url);
    return 'redirected';
  }
  return 'changed';
}

// The pricing dialog: one per page, opened from any Upgrade button or a plan limit.
type PricingState = { open: boolean; reason: string | null };
let pricing: PricingState = { open: false, reason: null };
const pricingListeners = new Set<() => void>();
const setPricing = (next: PricingState) => { pricing = next; pricingListeners.forEach((listener) => listener()); };

export function openPricing(reason?: string | null) {
  setPricing({ open: true, reason: reason ?? null });
}
export function closePricing() {
  setPricing({ open: false, reason: null });
}
export function usePricingDialog() {
  return useSyncExternalStore(
    (listener) => { pricingListeners.add(listener); return () => { pricingListeners.delete(listener); }; },
    () => pricing,
    () => pricing,
  );
}
