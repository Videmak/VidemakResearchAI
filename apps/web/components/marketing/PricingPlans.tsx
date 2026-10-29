'use client';

import { useState } from 'react';
import { IntervalToggle, PlanCards } from '@/components/billing/PlanCards';
import { usePlanChoice } from '@/components/billing/usePlanChoice';
import { usePlans, yearlySaving, type Interval, type PublicPlan } from '@/lib/billing';

/** The Monthly / Yearly toggle and the plan cards (plans come from Admin › Plans). */
export function PricingPlans({ initialPlans }: { initialPlans: PublicPlan[] | null }) {
  const [interval, setInterval] = useState<Interval>('year');
  const { plans } = usePlans(initialPlans ?? undefined);
  const { actionFor, currentId, error } = usePlanChoice(interval);
  return (
    <>
      <div className="pt-[26px] pb-[30px] text-center">
        <IntervalToggle value={interval} onChange={setInterval} saving={plans ? yearlySaving(plans) : 0} />
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-center text-[14px] text-red-700">{error}</p>}
      {plans ? (
        <PlanCards plans={plans} interval={interval} actionFor={actionFor} currentId={currentId} />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((index) => <div key={index} className="h-[460px] animate-pulse rounded-[20px] bg-white/70" />)}
        </div>
      )}
    </>
  );
}
