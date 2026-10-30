import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { container, focusRing, GITHUB_URL } from './styles';

/** Who runs this site, set when the web app is built (NEXT_PUBLIC_COMPANY_*); empty parts are left out. */
const COMPANY = {
  name: process.env.NEXT_PUBLIC_COMPANY_NAME || 'Videmak',
  address: process.env.NEXT_PUBLIC_COMPANY_ADDRESS || '',
  phone: process.env.NEXT_PUBLIC_COMPANY_PHONE || '',
  email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '',
};

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
    ],
  },
  {
    title: 'Open source',
    links: [
      { label: 'GitHub', href: GITHUB_URL },
      { label: 'Self-host', href: `${GITHUB_URL}#self-host-in-five-minutes` },
      { label: 'Developers', href: '/developers' },
      { label: 'MIT licence', href: `${GITHUB_URL}/blob/main/LICENSE` },
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
      <div className={`${container} grid gap-x-10 gap-y-10 pb-12 pt-14 md:grid-cols-[1.6fr_repeat(4,1fr)]`}>
        <div>
          <Link href="/" className={`inline-block rounded-lg ${focusRing}`}>
            <Logo size={24} />
            <span className="sr-only">Videmak home</span>
          </Link>
          <p className="mt-3 max-w-[280px] text-[14px] leading-relaxed text-muted">The AI editor for academic writing, with citations you can trust. Open source under the MIT licence.</p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4 md:contents">
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-labelledby={`footer-${column.title}`}>
              <h2 id={`footer-${column.title}`} className="mb-3 text-[11px] font-medium uppercase tracking-[.12em] text-subtle">{column.title}</h2>
              <ul className="text-[14px]">
                {column.links.map((link) => (
                  <li key={link.href} className="mb-2">
                    {link.href.startsWith('http')
                      ? <a href={link.href} target="_blank" rel="noreferrer" className={`rounded text-ink-2 transition-colors hover:text-ink ${focusRing}`}>{link.label}</a>
                      : <Link href={link.href} className={`rounded text-ink-2 transition-colors hover:text-ink ${focusRing}`}>{link.label}</Link>}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className={container}>
        <div className="flex flex-col gap-1.5 border-t border-line-2 py-6 text-[12.5px] text-subtle md:flex-row md:flex-wrap md:gap-x-4">
          <span>© {new Date().getFullYear()} {COMPANY.name}</span>
          {COMPANY.address && <span>{COMPANY.address}</span>}
          {COMPANY.phone && <a href={`tel:${COMPANY.phone.replace(/[^+\d]/g, '')}`} className="hover:text-ink">{COMPANY.phone}</a>}
          {COMPANY.email && <a href={`mailto:${COMPANY.email}`} className="hover:text-ink">{COMPANY.email}</a>}
        </div>
      </div>
    </footer>
  );
}
