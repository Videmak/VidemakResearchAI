'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { LuFingerprint, LuX } from 'react-icons/lu';
import { hasSignedInMark, takeSignedInMark, useSession } from '@/lib/session';
import { addPasskey, getMethods, getMyMethods, passkeyCancelled, passkeysSupported } from '@/lib/signin';

const OFF_KEY = (userId: string) => `videmak-passkey-prompt-off:${userId}`;
const AUTH_PAGES = /^\/(login|signup|auth)(\/|$)/;

/**
 * After a sign-in with a password or Google/Microsoft/Apple: a small card offering a passkey,
 * once per sign-in, unless the person has one already or chose "Don't show again".
 */
export function PasskeyPrompt() {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const pathname = usePathname() || '';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    // Keyed on the person, not the user object: it is replaced when the session refreshes.
    if (!userId || AUTH_PAGES.test(pathname)) return;
    if (!hasSignedInMark()) return;
    let off = false;
    try { off = window.localStorage.getItem(OFF_KEY(userId)) === '1'; } catch { /* storage blocked */ }
    if (off || !passkeysSupported()) { takeSignedInMark(); return; }
    // A moment after the page settles, and only when passkeys are on and the person has none.
    const timer = window.setTimeout(() => {
      takeSignedInMark();
      Promise.all([getMethods(), getMyMethods()])
        .then(([methods, mine]) => { if (methods.passkeys && mine.passkeys.length === 0) setOpen(true); })
        .catch(() => {});
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [userId, pathname]);

  if (!open || !user) return null;

  const neverAgain = () => {
    try { window.localStorage.setItem(OFF_KEY(user.id), '1'); } catch { /* storage blocked */ }
    setOpen(false);
  };
  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await addPasskey();
      setMessage({ tone: 'ok', text: 'Passkey added. Next time, sign in with your fingerprint, face or screen lock.' });
      window.setTimeout(() => setOpen(false), 2600);
    } catch (caught) {
      if (!passkeyCancelled(caught)) setMessage({ tone: 'error', text: (caught as Error).message || 'The passkey could not be added.' });
    }
    setBusy(false);
  };

  return (
    <div role="dialog" aria-labelledby="passkey-prompt-title"
      className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-[14000] mx-auto max-w-[400px] rounded-2xl border border-line bg-white p-4 shadow-[0_22px_50px_-18px_rgba(15,23,42,.35)] md:inset-x-auto md:bottom-6 md:right-6 md:mx-0">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand"><LuFingerprint className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p id="passkey-prompt-title" className="text-[15px] font-semibold text-ink">Sign in faster with a passkey</p>
          <p className="mt-0.5 text-[13.5px] leading-snug text-muted">Use your fingerprint, face or screen lock. No password to type.</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-subtle hover:bg-soft hover:text-ink">
          <LuX className="h-4 w-4" />
        </button>
      </div>
      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-3 rounded-lg px-3 py-2 text-[13px] ${message.tone === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>{message.text}</p>}
      <div className="mt-3.5 flex items-center gap-2">
        <button type="button" onClick={() => void create()} disabled={busy}
          className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-[10px] bg-brand px-3.5 text-[13.5px] font-semibold text-white shadow-brand hover:bg-brand-600 disabled:opacity-70">
          {busy ? 'Waiting for your device…' : 'Create passkey'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-9 shrink-0 whitespace-nowrap rounded-[10px] px-3 text-[13.5px] font-medium text-ink-2 hover:bg-soft">Not now</button>
        <button type="button" onClick={neverAgain} className="ml-auto h-9 shrink-0 whitespace-nowrap rounded-[10px] px-1.5 text-[13px] text-muted hover:text-ink">Don&apos;t show again</button>
      </div>
    </div>
  );
}
