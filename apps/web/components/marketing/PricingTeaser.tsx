import Link from 'next/link';
import { LuArrowRight, LuCheck } from 'react-icons/lu';
import type { PublicPlan } from '@/lib/billing';
import { btnGhost, btnPrimary, container } from './styles';

const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** The price line of a plan card: per month billed yearly when there is a yearly price. */
function price(plan: PublicPlan) {
  if (plan.checkout === 'contact') return { amount: 'Custom', unit: '', note: 'For labs and departments' };
  if (!plan.monthly_cents && !plan.yearly_cents) return { amount: '$0', unit: 'forever', note: 'No credit card' };
  if (plan.yearly_cents) return { amount: dollars(Math.round(plan.yearly_cents / 12)), unit: '/ month', note: `Billed yearly · ${dollars(plan.monthly_cents)} monthly` };
  return { amount: dollars(plan.monthly_cents), unit: '/ month', note: 'Billed monthly' };
}

/** Pricing on the landing page: the live plans from Admin › Plans, three highlights each. */
export function PricingTeaser({ plans }: { plans: PublicPlan[] | null }) {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className={`${container} scroll-mt-6 pt-24 md:pt-36`}>
      <h2 id="pricing-title" className="mx-auto max-w-[620px] text-balance text-center text-[30px] font-semibold leading-[1.12] tracking-[-0.03em] text-ink md:text-[40px]">
        Free to start. Simple plans.
      </h2>
      <p className="mx-auto mt-4 max-w-[460px] text-balance text-center text-[16px] leading-[1.6] text-muted md:text-[17px]">The full editor is free, with a daily AI allowance. Paid plans lift the limits.</p>
      {plans && plans.length > 0 && (
        <ul className={`mt-10 grid gap-4 md:mt-12 md:grid-cols-2 ${plans.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
          {plans.map((plan) => {
            const line = price(plan);
            return (
              <li key={plan.id} className={`relative flex flex-col rounded-[20px] bg-white p-5 ${plan.featured ? 'border-2 border-brand shadow-[0_24px_50px_-34px_rgba(37,99,235,.55)]' : 'border border-line'}`}>
                {plan.featured && <span className="absolute -top-2.5 left-5 rounded-full bg-brand px-2 py-0.5 text-[11.5px] font-semibold text-white">Most popular</span>}
                <h3 className="text-[15px] font-semibold text-ink">{plan.name}</h3>
                <p className="mt-2.5 flex items-baseline gap-1.5">
                  <span className="text-[30px] font-semibold leading-none tracking-[-0.03em] text-ink">{line.amount}</span>
                  {line.unit && <span className="text-[13px] text-muted">{line.unit}</span>}
                </p>
                <p className="mt-1.5 text-[12.5px] text-muted">{line.note}</p>
                <ul className="mt-4 flex flex-1 flex-col gap-2 text-[14px] text-ink-2">
                  {plan.features.filter((feature) => feature.included).slice(0, 3).map((feature) => (
                    <li key={feature.label} className="flex gap-2">
                      <LuCheck className="mt-[3px] h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                      {feature.label}
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.checkout === 'contact' ? plan.contact_url || '/pricing' : plan.is_default ? '/signup' : '/pricing'}
                  className={`${plan.featured ? btnPrimary : btnGhost} mt-5 h-10 rounded-[10px] text-[14px]`}
                >
                  {plan.checkout === 'contact' ? 'Talk to us' : plan.is_default ? 'Start free' : `See ${plan.name}`}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-6 text-center text-[14px] text-muted">
        <Link href="/pricing" className="inline-flex items-center gap-1 text-ink underline-offset-4 hover:underline">Compare all plans <LuArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
      </p>
    </section>
  );
}
