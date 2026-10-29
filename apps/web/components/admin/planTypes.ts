/** Shapes returned by /api/admin/plans (see apps/server/src/routes/adminPlans.ts). */

export type CountLimit = { amount: number | null; per: 'day' | 'month' };
export type Limits = Record<string, CountLimit | number | boolean | null>;
export type LimitDef = { kind: 'count' | 'total' | 'feature'; label: string; noun: string };
export type PlanFeature = { label: string; included: boolean };

export type AdminPlan = {
  id: string; name: string; tagline: string; sort_order: number; is_default: boolean; is_public: boolean; featured: boolean;
  checkout: 'self_serve' | 'contact'; contact_url: string | null; monthly_cents: number; yearly_cents: number; currency: string;
  trial_days: number; limits: Limits; features: PlanFeature[]; subscribers: number;
  stripe_product_id: string | null; stripe_monthly_price_id: string | null; stripe_yearly_price_id: string | null; stripe_mode: string | null;
};

export type PlansResponse = { plans: AdminPlan[]; limit_defs: Record<string, LimitDef>; stripe_ready: boolean };

export type Subscriber = {
  email: string; plan: string | null; plan_status: string; plan_source: string; plan_interval: string | null;
  plan_period_end: string | null; plan_cancel_at_period_end: boolean;
};

export function money(cents: number, currency = 'usd') {
  const amount = cents / 100;
  try {
    return amount.toLocaleString('en-US', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 });
  } catch {
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** Where a plan stands on Stripe: not sold there, missing prices, or synced (test/live). */
export function stripeState(plan: AdminPlan): { tone: 'positive' | 'neutral' | 'warning'; label: string } {
  if (plan.is_default || plan.checkout !== 'self_serve') return { tone: 'neutral', label: 'No checkout' };
  const ready = Boolean(plan.stripe_product_id)
    && (plan.monthly_cents <= 0 || Boolean(plan.stripe_monthly_price_id))
    && (plan.yearly_cents <= 0 || Boolean(plan.stripe_yearly_price_id))
    && (plan.monthly_cents > 0 || plan.yearly_cents > 0);
  if (!ready) return { tone: 'warning', label: 'Not on Stripe' };
  return { tone: 'positive', label: plan.stripe_mode === 'live' ? 'Stripe live' : 'Stripe test' };
}
