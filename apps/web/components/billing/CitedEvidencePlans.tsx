'use client';

import { useEffect, useState } from 'react';
import { LuArrowUpRight, LuRefreshCw } from 'react-icons/lu';
import { api, getToken, setSession, useSession, type SessionUser } from '@/lib/session';
import { getMethods, startProvider, type CitedEvidencePlans } from '@/lib/signin';
import { ProviderLogo } from '@/components/auth/ProviderLogo';

/**
 * Accounts and plans on CitedEvidence: where Upgrade buttons and the "no plan" notice send
 * people, and the "I've upgraded" check that reads their CitedEvidence plan again.
 */

/** CitedEvidence's plan links when accounts live there; null otherwise (or still loading: undefined). */
export function useCitedEvidencePlans(): CitedEvidencePlans | null | undefined {
  const [plans, setPlans] = useState<CitedEvidencePlans | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    getMethods().then((methods) => live && setPlans(methods.citedevidence_plans ?? null)).catch(() => live && setPlans(null));
    return () => { live = false; };
  }, []);
  return plans;
}

/** Reads the CitedEvidence plan again now; true when Videmak is open to them. */
export async function recheckCitedEvidencePlan() {
  const fresh = await api<SessionUser>('/api/auth/citedevidence/refresh', { method: 'POST' });
  const token = getToken();
  if (token) setSession(token, fresh);
  return fresh.has_access !== false;
}

export function CitedEvidencePlanPanel({ plans, reason, compact = false, onAccess }: {
  plans: CitedEvidencePlans; reason?: string | null; compact?: boolean; onAccess?: () => void;
}) {
  const { user } = useSession();
  const [state, setState] = useState<'idle' | 'checking' | 'missing' | 'error'>('idle');
  // Signed in from before plans moved to CitedEvidence: connect it first (keeps this account and its documents).
  const unlinked = user?.citedevidence_linked === false;
  const connect = async () => {
    setState('checking');
    try {
      await startProvider('citedevidence', { mode: 'connect' });
    } catch {
      setState('error');
    }
  };
  const recheck = async () => {
    setState('checking');
    try {
      if (await recheckCitedEvidencePlan()) { setState('idle'); onAccess?.(); }
      else setState('missing');
    } catch {
      setState('error');
    }
  };
  return (
    <div className={compact ? 'flex flex-col gap-3 sm:flex-row sm:items-center' : 'flex flex-col items-center text-center'}>
      {!compact && <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white shadow-card"><ProviderLogo provider="citedevidence" size={30} /></span>}
      <div className="min-w-0 flex-1">
        <p className={compact ? 'text-[15px] font-semibold text-ink' : 'text-[20px] font-bold tracking-[-0.01em] text-ink'}>
          Videmak is included with {plans.included_with}
        </p>
        <p className={`mt-1 text-muted ${compact ? 'text-[13.5px]' : 'text-[14.5px]'}`}>
          {unlinked ? 'Connect your CitedEvidence account to use your plan here. Your documents stay in this account.'
            : reason && !compact && !reason.startsWith('Videmak is included') ? reason : 'Choose a plan on CitedEvidence, then come back here.'}
        </p>
        {state === 'missing' && <p role="status" className="mt-1.5 text-[13.5px] font-medium text-amber-700">No plan that includes Videmak yet. It can take a minute after paying.</p>}
        {state === 'error' && <p role="alert" className="mt-1.5 text-[13.5px] font-medium text-red-700">Couldn&apos;t reach CitedEvidence. Try again.</p>}
      </div>
      <div className={`flex shrink-0 flex-wrap gap-2 ${compact ? '' : 'mt-5 justify-center'}`}>
        {unlinked && (
          <button type="button" onClick={() => void connect()} disabled={state === 'checking'}
            className="inline-flex h-10 items-center gap-2 rounded-[11px] bg-brand px-4 text-[14px] font-semibold text-white shadow-brand hover:bg-brand-600 disabled:opacity-60">
            <ProviderLogo provider="citedevidence" size={18} />{state === 'checking' ? 'Opening CitedEvidence…' : 'Connect CitedEvidence'}
          </button>
        )}
        <a href={plans.pricing_url} target="_blank" rel="noopener"
          className={`inline-flex h-10 items-center gap-1.5 rounded-[11px] px-4 text-[14px] font-semibold ${unlinked ? 'border border-line bg-white text-ink-2 hover:bg-soft' : 'bg-brand text-white shadow-brand hover:bg-brand-600'}`}>
          See CitedEvidence plans<LuArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </a>
        {!unlinked && (
          <button type="button" onClick={() => void recheck()} disabled={state === 'checking'}
            className="inline-flex h-10 items-center gap-1.5 rounded-[11px] border border-line bg-white px-4 text-[14px] font-semibold text-ink-2 hover:bg-soft disabled:opacity-60">
            <LuRefreshCw className={`h-4 w-4 ${state === 'checking' ? 'animate-spin' : ''}`} aria-hidden="true" />{state === 'checking' ? 'Checking…' : 'I’ve upgraded'}
          </button>
        )}
      </div>
    </div>
  );
}
