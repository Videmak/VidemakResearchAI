'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LuMenu, LuX, LuYoutube } from 'react-icons/lu';
import { AuthAware } from '@/components/marketing/AuthAware';
import { CE, WHATSAPP } from './links';

/**
 * The classic Videmak pages (home, legal pages, contact), kept as the old videmak.net showed them:
 * the pill menu, the dark curved footer and the floating "Get Support" button. Their links go
 * to CitedEvidence as they did.
 */

const MENU = [
  { label: 'Home', href: '/' },
  { label: 'Features', href: CE },
  { label: 'Pricing', href: `${CE}/pricing` },
  { label: 'FAQs', href: `${CE}/help` },
  { label: 'Blogs', href: `${CE}/help` },
];

export function ClassicMenu({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const account = (
    <AuthAware
      initial={signedIn}
      signedIn={<Link href="/editor" className="rounded-full bg-[#101828] px-5 py-2 text-[13px] font-semibold text-white hover:bg-black">Dashboard</Link>}
      signedOut={(
        <>
          <Link href="/login" className="text-[13px] font-semibold text-black hover:text-[#0d6efd]">Sign In</Link>
          <a href={`${CE}/register?from=videmak&reason=registration-moved`} className="rounded-full bg-[#101828] px-6 py-2 text-[13px] font-semibold text-white hover:bg-black">Start on CitedEvidence</a>
        </>
      )}
    />
  );
  return (
    <div className="relative z-[60] px-[15px] pt-[15px]">
      <nav aria-label="Main" className="mx-auto flex max-w-[95%] items-center rounded-[60px] border border-black bg-white/60 px-5 py-2.5 backdrop-blur md:py-3">
        <Link href="/" className="shrink-0 pl-2 md:pl-5" aria-label="Videmak Research AI home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/classic/logo.png" alt="VIDEMAK Logo" className="h-[40px] w-auto object-contain md:h-[50px]" style={{ filter: 'contrast(120%) brightness(110%)', padding: 5 }} />
        </Link>
        <ul className="mx-auto hidden items-center gap-12 lg:flex">
          {MENU.map((item) => (
            <li key={item.label}>
              <a href={item.href} aria-current={item.href === '/' ? 'page' : undefined} className="text-[14px] font-semibold text-black hover:text-[#0d6efd]">{item.label}</a>
            </li>
          ))}
        </ul>
        <div className="ml-auto hidden items-center gap-5 pr-2 lg:flex">{account}</div>
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="classic-menu"
          className="ml-auto grid size-10 place-items-center rounded-full text-black lg:hidden">
          {open ? <LuX className="size-6" /> : <LuMenu className="size-6" />}
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
        </button>
      </nav>
      {open && (
        <div id="classic-menu" className="mx-auto mt-2 max-w-[95%] rounded-3xl bg-[rgb(195,193,255)] px-6 py-5 lg:hidden">
          <ul className="flex flex-col gap-3">
            {MENU.map((item) => <li key={item.label}><a href={item.href} className="block text-[15px] font-semibold text-black">{item.label}</a></li>)}
          </ul>
          <div className="mt-5 flex flex-wrap items-center gap-4">{account}</div>
        </div>
      )}
    </div>
  );
}

/** "200M+ Citations By AI" → "300M+ Research Articles" → … sliding in, as the old banner did. */
export function RotatingHeadline({ phrases }: { phrases: string[] }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % phrases.length), 2500);
    return () => window.clearInterval(timer);
  }, [phrases.length]);
  return (
    // All phrases share one grid cell, so the line is as tall as the longest one when it wraps on a phone.
    <span className="grid overflow-hidden" aria-live="off">
      {phrases.map((phrase, position) => (
        <b
          key={phrase}
          aria-hidden={position !== index}
          className="block bg-[linear-gradient(to_right,red,blue)] bg-clip-text font-extrabold text-transparent transition-all duration-500 ease-out [grid-area:1/1]"
          style={{ transform: `translateY(${position === index ? 0 : position === (index + phrases.length - 1) % phrases.length ? -110 : 110}%)`, opacity: position === index ? 1 : 0 }}
        >
          {phrase}
        </b>
      ))}
    </span>
  );
}

/** The floating "Get Support" button: WhatsApp, or a ticket. */
export function SupportWidget() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && (
        <div className="fixed bottom-[95px] right-[25px] z-[9999] flex flex-col gap-3">
          <a href={WHATSAPP} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-lg bg-[#25D366] px-4 py-3 text-[14px] font-bold text-white shadow-[0_6px_16px_rgba(0,0,0,.25)]">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm5.8 14.07c-.24.68-1.42 1.3-1.95 1.35-.5.05-.98.24-3.3-.69-2.78-1.1-4.55-3.95-4.69-4.13-.14-.18-1.12-1.49-1.12-2.85 0-1.35.71-2.02.96-2.29.25-.27.55-.34.73-.34h.52c.17 0 .4-.06.62.48.24.56.8 1.94.87 2.08.07.14.12.3.02.48-.09.18-.14.3-.27.46-.14.16-.29.36-.41.48-.14.14-.28.29-.12.56.16.27.71 1.17 1.52 1.9 1.05.93 1.93 1.22 2.2 1.36.27.14.43.11.59-.07.16-.18.68-.79.86-1.06.18-.27.36-.23.61-.14.25.09 1.59.75 1.86.89.27.14.45.2.52.32.07.11.07.66-.17 1.33Z" /></svg>
            WhatsApp Chat
          </a>
          <Link href="/contact" className="flex items-center gap-2.5 rounded-lg bg-[#212529] px-4 py-3 text-[14px] font-bold text-white shadow-[0_6px_16px_rgba(0,0,0,.25)]">🎫 Submit Ticket</Link>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="fixed bottom-[25px] right-[25px] z-[9999] flex items-center gap-2 rounded-[30px] bg-[#0d6efd] px-[22px] py-[14px] text-[16px] text-white shadow-[0_2px_4px_rgba(0,0,0,.25),0_6px_12px_rgba(0,0,0,.5),0_12px_24px_rgba(0,0,0,.9)] transition-colors hover:bg-[#0b5ed7]"
      >
        💬 Get Support
      </button>
    </>
  );
}

const FOOTER_LINKS = [
  { label: 'Terms and Conditions', href: '/page/terms-and-conditions' },
  { label: 'Privacy Policy', href: '/page/privacy_policy' },
  { label: 'Data Deletion Policy', href: '/page/data-deletion-policy' },
  { label: 'Contact Us', href: '/contact' },
];

export function ClassicFooter() {
  return (
    <footer className="bg-[#1e222c] text-center">
      {/* The white page above the footer's curved top edge. */}
      <svg className="block h-[50px] w-full md:h-[86px]" preserveAspectRatio="none" viewBox="0 0 1440 86" aria-hidden="true">
        <path d="M0 85.662C240 29.1253 480 0.857 720 0.857C960 0.857 1200 29.1253 1440 85.662V0H0V85.662Z" fill="#ffffff" />
      </svg>
      <div className="mx-auto max-w-[1140px] px-4 pb-6 pt-10">
        <h2 className="text-[34px] font-extrabold leading-tight text-white md:text-[52px]" style={{ textShadow: '0 2px 6px rgba(0,0,0,.35)' }}>Save time. Get Started Now.</h2>
        <h3 className="mt-6 text-[20px] font-bold text-[#9ca3af] md:text-[27px]">Unleash the most advanced AI creator</h3>
        <h3 className="mt-2 text-[20px] font-bold text-[#9ca3af] md:text-[27px]">and boost your productivity</h3>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/classic/logo-white.png" alt="Brand Logo" className="mx-auto mt-14 h-[50px] w-auto object-contain" style={{ filter: 'contrast(120%) brightness(110%)', padding: 5 }} />
        <p className="mb-14 mt-3 text-[12px] text-[#9ca3af]"><span className="mr-2">Try for free.</span><span>No credit card required</span></p>
        <nav aria-label="Legal" className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-[13px]">
          {FOOTER_LINKS.map((link) => <Link key={link.href} href={link.href} className="text-[#9ca3af] hover:text-white">{link.label}</Link>)}
        </nav>
      </div>
      <div className="mx-auto max-w-[1200px] border-t border-white/10 px-4 pb-6 pt-8">
        <a href="https://www.youtube.com/@AdvancedChatGPT" target="_blank" rel="noreferrer" aria-label="YouTube" className="inline-grid size-9 place-items-center rounded-full text-[#9ca3af] hover:text-white">
          <LuYoutube className="size-5" />
        </a>
        <p className="mt-6 text-[13px] text-[#9ca3af]">© {new Date().getFullYear()} <a href="https://videmak.net" className="font-bold text-[#0d6efd]">Videmak Research AI</a>. All rights reserved.</p>
      </div>
    </footer>
  );
}
