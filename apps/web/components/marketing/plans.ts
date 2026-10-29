import type { CountLimit, PublicPlan } from '@/lib/billing';

/**
 * /pricing reads the plans from the API (Admin › Plans is the one place to change them).
 * This file turns them into the comparison table and the page description.
 */

const serverUrl = process.env.VIDEMAK_SERVER_URL || 'http://localhost:4000';

export async function loadPublicPlans(): Promise<PublicPlan[] | null> {
  try {
    const response = await fetch(`${serverUrl}/api/plans`, { next: { revalidate: 300 } });
    if (!response.ok) return null;
    return ((await response.json()) as { plans: PublicPlan[] }).plans;
  } catch {
    return null; // e.g. while building: the page fills in on the client and on the next revalidation
  }
}

/** A cell of the comparison table: text, or true (included) / false (not included). */
export type CompareValue = string | boolean;

const count = (limit: CountLimit): CompareValue =>
  limit.amount === null ? 'Unlimited' : limit.amount === 0 ? false : `${limit.amount.toLocaleString('en-US')} / ${limit.per}`;

export function comparisonRows(plans: PublicPlan[]): { feature: string; values: CompareValue[] }[] {
  const row = (feature: string, value: (plan: PublicPlan) => CompareValue) => ({ feature, values: plans.map(value) });
  return [
    row('AI autocomplete', (plan) => count(plan.limits.autocomplete)),
    row('AI Edit', (plan) => count(plan.limits.ai_edit)),
    row('AI Chat messages', (plan) => count(plan.limits.chat)),
    row('Review checks', (plan) => count(plan.limits.review)),
    row('Write with AI drafts', (plan) => count(plan.limits.write)),
    row('PDFs in your Library', (plan) => (plan.limits.library_pdfs === null ? 'Unlimited' : plan.limits.library_pdfs.toLocaleString('en-US'))),
    row('Citations in every style', () => true),
    row('Word and PDF export', () => true),
    row('LaTeX export', (plan) => plan.limits.latex_export),
  ];
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** One-line summary used in the /pricing meta description. */
export function pricingSummary(plans: PublicPlan[] | null) {
  const paid = (plans ?? []).filter((plan) => plan.monthly_cents > 0);
  if (!paid.length) return 'Start free with the full editor. Upgrade for more AI writing, citations, review and LaTeX export.';
  const cheapest = paid.reduce((low, plan) => (plan.monthly_cents < low.monthly_cents ? plan : low));
  const perMonthYearly = cheapest.yearly_cents ? usd(Math.round(cheapest.yearly_cents / 12)) : null;
  return `Start free with the full editor. ${cheapest.name} is ${usd(cheapest.monthly_cents)}/month${perMonthYearly ? ` or ${perMonthYearly}/month billed yearly` : ''}, with more AI writing, review checks and LaTeX export.`;
}
