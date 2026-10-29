'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LuX, LuZap } from 'react-icons/lu';
import { closePricing, usePlans, usePricingDialog, yearlySaving, type Interval } from '@/lib/billing';
import { IntervalToggle, PlanCards } from './PlanCards';
import { usePlanChoice } from './usePlanChoice';

/** The pricing pop-up: every Upgrade button and plan limit opens it. */
export function PricingDialog() {
  const { open, reason } = usePricingDialog();
  if (!open) return null;
  return createPortal(<PricingDialogBody reason={reason} />, document.body);
}

function PricingDialogBody({ reason }: { reason: string | null }) {
  const { plans, error: loadError } = usePlans();
  const [interval, setInterval] = useState<Interval>('year');
  const [changed, setChanged] = useState<string | null>(null);
  const { actionFor, currentId, error } = usePlanChoice(interval, (plan) => setChanged(plan.name));
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closePricing(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, []);

  return (
    <div className="fixed inset-0 z-[20000] flex items-end justify-center bg-ink/45 sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) closePricing(); }}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="pricing-title"
        className="max-h-[94dvh] w-full max-w-[1180px] overflow-y-auto rounded-t-[22px] bg-soft outline-none sm:rounded-[22px]">
        <div className="sticky top-0 z-10 flex items-start gap-3 bg-soft/95 px-5 pt-5 pb-3 backdrop-blur sm:px-8 sm:pt-7">
          <div className="min-w-0 flex-1">
            <h2 id="pricing-title" className="text-[24px] font-bold tracking-[-0.02em] text-ink sm:text-[28px]">Choose your plan</h2>
            {reason && !changed && (
              <p className="mt-2 inline-flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[14px] text-amber-900">
                <LuZap className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{reason}
              </p>
            )}
          </div>
          <button type="button" onClick={closePricing} aria-label="Close" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-white hover:text-ink">
            <LuX className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 pb-7 sm:px-8">
          {changed ? (
            <div className="flex flex-col items-center py-14 text-center">
              <p className="text-[20px] font-bold text-ink">You&apos;re on {changed} now</p>
              <p className="mt-1 text-[14.5px] text-muted">The new limits apply straight away.</p>
              <button type="button" onClick={closePricing} className="mt-5 h-11 rounded-[11px] bg-brand px-6 text-[15px] font-semibold text-white shadow-brand hover:bg-brand-600">Done</button>
            </div>
          ) : (
            <>
              <div className="mb-6 flex flex-wrap items-center gap-3">
                <IntervalToggle value={interval} onChange={setInterval} saving={plans ? yearlySaving(plans) : 0} />
                <a href="/pricing" className="text-[13.5px] text-muted underline underline-offset-4 hover:text-ink">Compare plans</a>
              </div>
              {(error || loadError) && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-[14px] text-red-700">{error || loadError}</p>}
              {plans ? (
                <PlanCards plans={plans} interval={interval} actionFor={actionFor} currentId={currentId} compact />
              ) : !loadError && (
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4" aria-busy="true">
                  {[0, 1, 2, 3].map((index) => <div key={index} className="h-[420px] animate-pulse rounded-[20px] bg-white" />)}
                </div>
              )}
              <p className="mt-5 text-center text-[13px] text-subtle">Secure payment by Stripe · Cancel any time</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
