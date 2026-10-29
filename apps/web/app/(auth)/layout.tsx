import Link from 'next/link';
import { LuArrowLeft, LuCheck } from 'react-icons/lu';
import { Logo } from '@/components/Logo';
import { focusRing } from '@/components/marketing/styles';

const HIGHLIGHTS = ['Autocomplete that cites real papers', '250M+ papers to find and cite', 'Word, PDF and LaTeX export'];

/**
 * Sign-in pages: the brand column on the left (wide screens),
 * the one sign-in form on the right; a slim brand bar on phones.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-white text-ink lg:grid-cols-2">
      <aside className="flex items-center justify-between border-b border-line bg-soft px-5 py-3 lg:flex-col lg:items-stretch lg:justify-between lg:border-b-0 lg:border-r lg:px-10 lg:py-8">
        <Link href="/" className={`rounded-lg ${focusRing}`}>
          <Logo size={30} />
          <span className="sr-only">Videmak home</span>
        </Link>
        <div className="hidden max-w-[500px] py-10 lg:block">
          <p className="mb-5 text-[12px] font-semibold uppercase tracking-[0.2em] text-muted">Your writing workspace</p>
          <p className="text-[clamp(36px,3.4vw,50px)] font-bold leading-[1.08] tracking-[-0.035em]">From first draft<br />to final paper.</p>
          <p className="mt-5 text-[17px] leading-relaxed text-ink-2">Write, cite and review in one place.</p>
          <ul className="mt-7 flex flex-col gap-3 border-t border-line pt-7 text-[15px] text-ink-2">
            {HIGHLIGHTS.map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <LuCheck className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />{item}
              </li>
            ))}
          </ul>
        </div>
        <p className="hidden text-[13px] text-muted lg:block">
          © {new Date().getFullYear()} Videmak ·{' '}
          <Link href="/help" className="hover:text-ink">Help center</Link> ·{' '}
          <Link href="/pricing" className="hover:text-ink">Pricing</Link>
        </p>
        <Link href="/" className={`inline-flex items-center gap-1.5 rounded text-[13px] text-muted hover:text-ink lg:hidden ${focusRing}`}>
          <LuArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Home
        </Link>
      </aside>
      <main className="flex min-w-0 flex-col px-5 pb-10 pt-6 sm:px-8 lg:px-10 lg:pt-7">
        <Link href="/" className={`hidden items-center gap-1.5 self-end rounded text-[13px] text-muted hover:text-ink lg:inline-flex ${focusRing}`}>
          <LuArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Back to home
        </Link>
        <div className="mx-auto my-auto w-full max-w-[420px] py-6">{children}</div>
      </main>
    </div>
  );
}
