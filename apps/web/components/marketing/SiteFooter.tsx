import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { container, focusRing } from './styles';

// Only pages that exist. Privacy and Terms come back once their text is written (no page yet).
const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '/features' },
      { label: 'How it works', href: '/how-it-works' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'FAQ', href: '/#faq' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Help center', href: '/help' },
      { label: 'Citation styles', href: '/citation-styles' },
      { label: 'Developers', href: '/developers' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Sign in', href: '/login' },
      { label: 'Create account', href: '/signup' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className={`${container} grid gap-x-10 gap-y-10 pb-12 pt-14 md:grid-cols-[1.6fr_repeat(3,1fr)]`}>
        <div>
          <Link href="/" className={`inline-block rounded-lg ${focusRing}`}>
            <Logo size={24} />
            <span className="sr-only">Videmak home</span>
          </Link>
          <p className="mt-3 max-w-[280px] text-[14px] leading-relaxed text-muted">The AI editor for academic writing, with citations you can trust.</p>
        </div>
        <div className="grid grid-cols-3 gap-4 md:contents">
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-labelledby={`footer-${column.title}`}>
              <h2 id={`footer-${column.title}`} className="mb-3 text-[11px] font-medium uppercase tracking-[.12em] text-subtle">{column.title}</h2>
              <ul className="text-[14px]">
                {column.links.map((link) => (
                  <li key={link.href} className="mb-2">
                    <Link href={link.href} className={`rounded text-ink-2 transition-colors hover:text-ink ${focusRing}`}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className={container}>
        <p className="border-t border-line-2 py-6 text-[12.5px] text-subtle">© {new Date().getFullYear()} Videmak</p>
      </div>
    </footer>
  );
}
