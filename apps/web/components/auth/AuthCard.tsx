import type { ReactNode } from 'react';

/** A sign-in page's heading and content, in the form column of the sign-in layout. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="w-full">
      <h1 className="text-center text-[28px] font-bold leading-[1.15] tracking-[-0.025em] text-ink sm:text-[30px]">{title}</h1>
      {subtitle && <p className="mt-2 text-center text-[15px] leading-[1.55] text-muted">{subtitle}</p>}
      <div className="mt-7">{children}</div>
    </div>
  );
}

/** Terms / Privacy small print under the forms. */
export function LegalNote({ action }: { action: string }) {
  return (
    <p className="mt-6 text-center text-[12.5px] leading-[1.6] text-muted">
      By {action}, you agree to our{' '}
      <a href="/terms" className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink">
        Terms
      </a>{' '}
      and{' '}
      <a href="/privacy" className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink">
        Privacy Policy
      </a>
      .
    </p>
  );
}
