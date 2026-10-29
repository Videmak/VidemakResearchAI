/** Shared class strings for the public pages (marketing + auth), taken from the approved mockups. */

/** 1088px content column on desktop, 16px gutters on phones. */
export const container = 'mx-auto w-full max-w-[1136px] px-4 sm:px-6';

export const focusRing =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

const btnBase = `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[11px] border font-semibold transition-colors ${focusRing}`;

export const btnPrimary = `${btnBase} border-transparent bg-brand text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,.7)] hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-brand`;

export const btnGhost = `${btnBase} border-line bg-white text-ink hover:bg-soft`;

/** Small uppercase label above a section heading. */
export const kicker = 'mb-3 text-sm font-bold uppercase tracking-[.08em] text-brand';

/** Big section heading. */
export const sectionTitle =
  'max-w-[760px] text-balance text-[30px] lg:text-wrap font-bold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[38px] lg:text-[44px]';
