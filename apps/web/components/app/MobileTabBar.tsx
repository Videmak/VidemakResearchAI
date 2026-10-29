'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { showSideload, useMobileTabBarHidden, useSideloads, type SideloadTool } from '@videmak/editor';

const glyph = (paths: React.ReactNode) => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
);
const DOCS_ICON = glyph(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>);
// Library, Papers and Chat open full-screen panels over the page, never separate pages.
const TOOLS: { id: SideloadTool; label: string; icon: React.ReactNode }[] = [
  { id: 'library', label: 'Library', icon: glyph(<path d="M4 19V5M8 19V5M12 19l4-14 4 14" />) },
  { id: 'papers', label: 'Papers', icon: glyph(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>) },
  { id: 'chat', label: 'Chat', icon: glyph(<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.6A8 8 0 1 1 21 12z" />) },
];

/** True while the on-screen keyboard is open (the visible viewport shrinks). */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setOpen(window.innerHeight - viewport.height > 140);
    viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, []);
  return open;
}

/** The mockup's phone tab bar: Docs, Library, a blue centre button for a new document, Papers, Chat. */
export function MobileTabBar() {
  const pathname = usePathname() || '';
  const hiddenByEditor = useMobileTabBarHidden();
  const keyboardOpen = useKeyboardOpen();
  const sideloads = useSideloads();
  if (hiddenByEditor || keyboardOpen) return null;
  const label = (active: boolean) => `flex flex-col items-center gap-[3px] text-[11px] font-semibold ${active ? 'text-brand' : 'text-subtle'}`;
  const tool = (item: (typeof TOOLS)[number]) => {
    const active = item.id === 'chat' ? sideloads.chat : sideloads.drawer === item.id;
    return (
      <button key={item.id} type="button" onClick={() => showSideload(item.id)} aria-pressed={active} className={label(active)}>
        {item.icon}{item.label}
      </button>
    );
  };
  const docsActive = pathname === '/editor' && !sideloads.drawer && !sideloads.chat;
  return (
    <>
      <div className="h-[84px] md:hidden" aria-hidden="true" />
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-[60] grid h-[84px] grid-cols-5 border-t border-line bg-white/95 px-1.5 pt-2 pb-[max(22px,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <Link href="/editor" aria-current={docsActive ? 'page' : undefined} className={label(docsActive)}>
          {DOCS_ICON}Docs
        </Link>
        {tool(TOOLS[0])}
        <Link href="/editor?new=1" aria-label="New document" className="flex justify-center">
          <span className="-mt-3.5 grid h-12 w-12 place-items-center rounded-2xl bg-brand shadow-[0_10px_20px_-8px_rgba(37,99,235,.8)]">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </span>
        </Link>
        {tool(TOOLS[1])}
        {tool(TOOLS[2])}
      </nav>
    </>
  );
}
