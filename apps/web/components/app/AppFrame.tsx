'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toggleSideload, useSideloads, type SideloadTool } from '@videmak/editor';
import { Logo } from '@/components/Logo';
import { EditorHost } from '@/components/app/EditorHost';
import { MobileTabBar } from '@/components/app/MobileTabBar';
import { api, getToken, useSession } from '@/lib/session';
import { openPricing } from '@/lib/billing';
import { LuZap } from 'react-icons/lu';

// Library and Find papers slide in from the left in place of the menu; AI Chat opens on the right.
const AppToolDrawer = dynamic(() => import('@videmak/editor').then((mod) => mod.AppToolDrawer), { ssr: false });
const AppChatSideload = dynamic(() => import('@videmak/editor').then((mod) => mod.AppChatSideload), { ssr: false });
const EditorToaster = dynamic(() => import('@videmak/editor').then((mod) => mod.EditorToaster), { ssr: false });
const docked = 'lg:sticky lg:top-0 lg:h-dvh';

const icon = (paths: React.ReactNode) => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
);
const ICONS = {
  new: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>),
  docs: icon(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>),
  library: icon(<path d="M4 19V5M8 19V5M12 19l4-14 4 14" />),
  papers: icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  chat: icon(<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.6A8 8 0 1 1 21 12z" />),
  keys: icon(<><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2 2M14 9l2 2" /></>),
  admin: icon(<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z" />),
  tutorials: icon(<><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3z" /></>),
  help: icon(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17h.01" /></>),
};

type Recent = { id: string; title: string };

function firstName(name: string) {
  return name.split(/\s+/)[0] || name;
}

/** Recent documents for the left nav (three, newest first). */
function useRecent(enabled: boolean) {
  const [recent, setRecent] = useState<Recent[]>([]);
  useEffect(() => {
    if (!enabled || !getToken()) return;
    api<{ documents: Recent[] }>('/api/ai-editor/documents').then((result) => setRecent(result.documents.slice(0, 3))).catch(() => {});
  }, [enabled]);
  return recent;
}

/**
 * Signed-in frame from the mockups: the soft-grey left nav on desktop; on phones the app
 * bar (title, Upgrade, tutorials, avatar) and the tab bar.
 */
export function AppFrame({ title, actions, children, wide = false }: { title: string; crumbs?: { label: string; href?: string }[]; actions?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  const pathname = usePathname() || '';
  const { user } = useSession();
  const recent = useRecent(Boolean(user));
  const name = user?.full_name || user?.email?.split('@')[0] || '';
  const isFree = Boolean(user) && (!user?.plan || user.plan === 'free');
  const sideloads = useSideloads();
  const itemClass = (active: boolean) =>
    `flex h-10 w-full items-center gap-[11px] rounded-[10px] px-2.5 text-left text-[15px] font-medium ${active ? 'bg-white text-ink shadow-[0_1px_2px_rgba(15,23,42,.06),0_0_0_1px_var(--color-line)]' : 'text-ink-2 hover:bg-white/70'}`;
  const item = (href: string, label: string, glyph: React.ReactNode, extra?: React.ReactNode) => {
    const active = pathname.startsWith(href);
    return (
      <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={itemClass(active)}>
        {glyph}{label}{extra}
      </Link>
    );
  };
  const tool = (id: SideloadTool, label: string, glyph: React.ReactNode, extra?: React.ReactNode) => {
    const active = id === 'chat' ? sideloads.chat : sideloads.drawer === id;
    return (
      <button key={id} type="button" onClick={() => toggleSideload(id)} aria-pressed={active} className={itemClass(active)}>
        {glyph}{label}{extra}
      </button>
    );
  };
  return (
    <div className="min-h-dvh bg-white md:flex">
      <aside className={`sticky top-0 h-dvh w-[232px] shrink-0 flex-col border-r border-line bg-soft px-3 pt-4 pb-3 ${sideloads.drawer && !sideloads.menu ? 'hidden md:flex lg:hidden' : 'hidden md:flex'}`}>
        <Link href="/" className="px-2 pb-[18px]" aria-label="Videmak home"><Logo size={32} /></Link>
        <Link href="/editor?new=1" className="flex h-10 items-center gap-[11px] rounded-[10px] px-2.5 text-[15px] font-semibold text-brand hover:bg-white/70">{ICONS.new}New document</Link>
        {tool('documents', 'Documents', ICONS.docs)}
        {tool('library', 'Library', ICONS.library, <span className="ml-auto text-subtle">›</span>)}
        {tool('papers', 'Find papers', ICONS.papers)}
        {tool('chat', 'AI Chat', ICONS.chat)}
        {recent.length > 0 && (
          <>
            <p className="px-2.5 pt-5 pb-1 text-[12px] font-medium text-subtle">Recent</p>
            {recent.map((doc) => (
              <Link key={doc.id} href={`/editor?doc=${doc.id}`} className="block h-[34px] truncate rounded-[10px] px-2.5 text-[14px] leading-[34px] text-ink-2 hover:bg-white/70">{doc.title || 'Untitled document'}</Link>
            ))}
          </>
        )}
        <div className="flex-1" />
        {item('/account', 'Account', ICONS.keys)}
        {user?.is_admin && item('/admin', 'Admin', ICONS.admin)}
        {item('/help', 'Help', ICONS.help)}
        {isFree && (
          <div className="mt-2 flex items-center justify-between rounded-[10px] bg-white/70 px-2.5 py-2">
            <span className="text-[13px] text-muted">{user?.plan_name || 'Free'} plan</span>
            <button type="button" onClick={() => openPricing()} className="text-[13px] font-semibold text-brand hover:underline">Upgrade</button>
          </div>
        )}
        <Link href="/account" className="flex items-center gap-2.5 px-2 pt-3 pb-0.5 text-[14px] font-medium">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-gradient-to-br from-amber-200 to-orange-400 text-[13px] font-bold text-orange-900">{(name[0] || '·').toUpperCase()}</span>
          <span className="truncate">{name || 'Account'}</span>
        </Link>
      </aside>
      <Suspense fallback={null}><EditorHost><AppToolDrawer className={docked} /></EditorHost></Suspense>

      <main className="min-w-0 flex-1">
        {/* Phones: the mockup's app bar */}
        <div className="flex h-14 items-center gap-2 px-[18px] md:hidden">
          <h1 className="min-w-0 flex-1 truncate text-[22px] font-extrabold tracking-[-0.02em]">{title}</h1>
          {isFree && <button type="button" onClick={() => openPricing()} className="flex h-[34px] items-center gap-1 rounded-full bg-brand px-3 text-[13px] font-bold text-white shadow-brand"><LuZap className="h-3.5 w-3.5" aria-hidden="true" />Upgrade</button>}
          <Link href="/account" aria-label="Account" className="grid h-[34px] w-[34px] place-items-center rounded-full bg-ink text-[14px] font-bold text-white">{(name[0] || '·').toUpperCase()}</Link>
        </div>
        {/* Desktop: page title and actions, as in the documents mockup */}
        <div className={`mx-auto px-[18px] pb-8 md:px-10 md:pt-7 ${wide ? 'max-w-6xl' : 'max-w-4xl'}`}>
          <div className="mb-6 hidden items-center gap-3.5 md:flex">
            <h1 className="flex-1 text-[26px] font-bold tracking-[-0.02em]">{title}</h1>
            {actions}
          </div>
          {actions && <div className="mb-4 flex flex-wrap gap-2 md:hidden">{actions}</div>}
          {children}
        </div>
        <MobileTabBar />
      </main>
      <Suspense fallback={null}><EditorHost><AppChatSideload className={docked} /></EditorHost></Suspense>
      <EditorToaster />
    </div>
  );
}
