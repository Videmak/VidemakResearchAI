'use client';

import React from 'react';
import { LuZap } from 'react-icons/lu';
import { useEditorConfig } from '../../../runtime';
import { lastPlanLimit } from '../../../lib/planLimit';

/** Shown inside an AI box when the plan's allowance is used up (HTTP 402). */
export default function CreditsUpsell({ feature = 'AI edits', onDismiss }: { feature?: string; onDismiss?: () => void; isMobile?: boolean }) {
  const config = useEditorConfig();
  const message = lastPlanLimit() || `Upgrade to keep using ${feature}.`;
  const upgrade = () => {
    if (config.onUpgrade) config.onUpgrade({ reason: 'plan_limit', message });
    else window.location.assign(config.navLinks?.pricing || '/pricing');
  };
  return (
    <div className="ce-credits-upsell rounded-[14px] border border-[#dbeafe] bg-[linear-gradient(180deg,#fff,#eff6ff)] p-[14px] text-[13px] text-[#334155]">
      <div className="min-w-0">
        <b className="text-[14px] text-[#0f172a]">Plan limit reached</b>
        <p className="mb-2.5 mt-1 text-[12.5px] leading-[1.45] text-[#64748b]">{message}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={upgrade}
            className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-[var(--theme-primary,#2563eb)] px-3.5 text-[13.5px] font-semibold text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,0.7)] hover:bg-[#1d4ed8]"
          >
            <LuZap className="h-4 w-4" aria-hidden="true" /> Upgrade
          </button>
          {onDismiss ? (
            <button type="button" onClick={onDismiss} className="inline-flex h-9 items-center rounded-[10px] px-2.5 text-[13px] font-medium text-[#64748b] hover:text-[#0f172a]">
              Not now
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
