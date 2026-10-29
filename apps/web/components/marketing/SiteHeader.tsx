import Link from 'next/link';
import { cookies } from 'next/headers';
import { LuArrowRight } from 'react-icons/lu';
import { Logo } from '@/components/Logo';
import { AuthAware } from './AuthAware';
import { SiteNav } from './SiteNav';
import { container, focusRing } from './styles';

/** Dark strip above the header for people who are not signed in. */
function FreePlanStrip() {
  return (
    <div className="bg-ink text-[12.5px] text-slate-300 md:text-[13px]">
      <div className={`${container} flex h-[34px] items-center justify-center gap-2.5 whitespace-nowrap md:h-[38px]`}>
        <span className="font-semibold text-white">Free plan</span>
        <span className="size-[3px] rounded-full bg-slate-500" aria-hidden="true" />
        <span>No <span className="max-[379px]:hidden">credit </span>card required</span>
        <Link href="/signup" className={`inline-flex items-center gap-1 rounded font-semibold text-blue-300 transition-colors hover:text-blue-200 ${focusRing}`}>
          Start writing <LuArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/** Free-plan strip, then logo with the links beside it and sign-in (or Dashboard) on the right. */
export async function SiteHeader() {
  // Set by the app at sign-in (not a secret): lets the first render show Dashboard without a flash.
  const signedIn = (await cookies()).get('videmak_signed_in')?.value === '1';
  return (
    <>
      <AuthAware initial={signedIn} signedIn={null} signedOut={<FreePlanStrip />} />
      <header className="border-b border-line bg-white">
        <div className={`${container} flex h-14 items-center md:h-16`}>
          <Link href="/" className={`shrink-0 rounded-lg ${focusRing}`}>
            <Logo size={26} />
            <span className="sr-only">Videmak home</span>
          </Link>
          <SiteNav signedIn={signedIn} />
        </div>
      </header>
    </>
  );
}
