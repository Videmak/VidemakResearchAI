'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LuCircleHelp, LuGithub, LuLayers, LuListChecks, LuTag } from 'react-icons/lu';
import { Logo } from '@/components/Logo';
import { CloseIcon, MenuIcon } from './icons';
import { AuthAware } from './AuthAware';
import { btnGhost, btnPrimary, focusRing, GITHUB_URL } from './styles';
import { getToken } from '@/lib/session';
import { openPricing } from '@/lib/billing';

export const NAV_LINKS = [
  { label: 'Features', href: '/features', hint: 'Autocomplete, papers, review', Icon: LuLayers },
  { label: 'How it works', href: '/how-it-works', hint: 'From blank page to export', Icon: LuListChecks },
  { label: 'Pricing', href: '/pricing', hint: 'Free and paid plans', Icon: LuTag },
  { label: 'Help', href: '/help', hint: 'Guides and answers', Icon: LuCircleHelp },
];

/** Signed-in people get the pricing pop-up instead of leaving the page. */
function pricingClick(href: string, event: React.MouseEvent) {
  if (href !== '/pricing' || !getToken() || window.location.pathname === '/pricing') return;
  event.preventDefault();
  openPricing();
}

function isCurrent(pathname: string, href: string) {
  if (href.includes('#')) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop links next to the logo (≥768px) and the phone menu button + full-screen sheet (<768px). */
export function SiteNav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname() || '/';
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    document.documentElement.style.overflow = open ? 'hidden' : '';
    return () => {
      document.documentElement.style.overflow = '';
    };
  }, [open]);

  // Close the sheet after navigating (including same-page hash links) and when the screen grows past the phone layout.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 768px)');
    const onChange = () => wide.matches && setOpen(false);
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, []);

  return (
    <>
      <nav aria-label="Main" className="ml-10 hidden items-center gap-[26px] text-[14px] font-medium md:flex">
        {NAV_LINKS.map((link) => {
          const current = isCurrent(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={(event) => pricingClick(link.href, event)}
              aria-current={current ? 'page' : undefined}
              className={`relative rounded-md transition-colors hover:text-ink ${current ? 'text-ink after:absolute after:inset-x-0 after:-bottom-[22px] after:h-0.5 after:rounded-full after:bg-ink' : 'text-muted'} ${focusRing}`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto hidden items-center gap-2 md:flex">
        <a href={GITHUB_URL} target="_blank" rel="noreferrer" title="Videmak is open source (MIT)"
          className={`mr-1 inline-flex h-9 items-center gap-1.5 rounded-[9px] px-2.5 text-[14px] font-medium text-muted transition-colors hover:bg-soft hover:text-ink ${focusRing}`}>
          <LuGithub className="size-[18px]" aria-hidden="true" /><span className="hidden lg:inline">GitHub</span><span className="sr-only lg:hidden">Videmak on GitHub</span>
        </a>
        <AuthAware
          initial={signedIn}
          signedIn={<Link href="/editor" className={`${btnPrimary} h-9 rounded-[9px] px-3.5 text-[14px]`}>Dashboard</Link>}
          signedOut={(
            <>
              <Link href="/login" className={`${btnGhost} h-9 rounded-[9px] px-3.5 text-[14px]`}>Sign in</Link>
              <Link href="/signup" className={`${btnPrimary} h-9 rounded-[9px] px-3.5 text-[14px]`}>Get started</Link>
            </>
          )}
        />
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="site-menu"
        className={`ml-auto grid size-10 place-items-center rounded-xl border border-line text-ink md:hidden ${focusRing}`}
      >
        <MenuIcon size={22} />
        <span className="sr-only">Open menu</span>
      </button>

      <dialog
        id="site-menu"
        ref={dialogRef}
        aria-label="Menu"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-white p-0 md:hidden"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-14 shrink-0 items-center px-4">
            <Link href="/" onClick={() => setOpen(false)} className={`rounded-lg ${focusRing}`}>
              <Logo size={26} />
              <span className="sr-only">Videmak home</span>
            </Link>
            <button
              type="button"
              autoFocus
              onClick={() => setOpen(false)}
              className={`ml-auto grid size-10 place-items-center rounded-xl border border-line text-ink ${focusRing}`}
            >
              <CloseIcon size={22} />
              <span className="sr-only">Close menu</span>
            </button>
          </div>
          <nav aria-label="Main" className="grid gap-1 px-3 pt-2">
            {NAV_LINKS.map(({ Icon, ...link }) => {
              const current = isCurrent(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={(event) => { setOpen(false); pricingClick(link.href, event); }}
                  aria-current={current ? 'page' : undefined}
                  className={`flex items-center gap-3.5 rounded-[14px] px-2 py-[11px] ${current ? 'bg-soft' : ''} ${focusRing}`}
                >
                  <span className={`grid size-[42px] shrink-0 place-items-center rounded-xl border ${current ? 'border-brand-100 bg-brand-50 text-brand' : 'border-line bg-white text-ink-2'}`} aria-hidden="true">
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[16.5px] font-semibold text-ink">{link.label}</span>
                    <span className="mt-0.5 block text-[13px] text-muted">{link.hint}</span>
                  </span>
                </Link>
              );
            })}
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={`flex items-center gap-3.5 rounded-[14px] px-2 py-[11px] ${focusRing}`}>
              <span className="grid size-[42px] shrink-0 place-items-center rounded-xl border border-line bg-white text-ink-2" aria-hidden="true"><LuGithub className="size-[18px]" /></span>
              <span className="min-w-0">
                <span className="block text-[16.5px] font-semibold text-ink">Open source</span>
                <span className="mt-0.5 block text-[13px] text-muted">MIT licensed, on GitHub</span>
              </span>
            </a>
          </nav>
          <div className="mt-auto grid gap-2.5 px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))]">
            <AuthAware
              initial={signedIn}
              signedIn={<Link href="/editor" onClick={() => setOpen(false)} className={`${btnPrimary} h-12 rounded-xl text-base`}>Dashboard</Link>}
              signedOut={(
                <>
                  <Link href="/login" onClick={() => setOpen(false)} className={`${btnGhost} h-12 rounded-xl text-base`}>Sign in</Link>
                  <Link href="/signup" onClick={() => setOpen(false)} className={`${btnPrimary} h-12 rounded-xl text-base`}>Get started</Link>
                </>
              )}
            />
          </div>
        </div>
      </dialog>
    </>
  );
}
