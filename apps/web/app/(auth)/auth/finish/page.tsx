'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { redeemTicket } from '@/lib/signin';
import { errorMessage } from '@/components/auth/fields';
import { btnPrimary } from '@/components/marketing/styles';

/** Back from Google, Microsoft or Apple: trades the one-time ticket for a session. */
export default function FinishSignInPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ticket = new URLSearchParams(window.location.hash.slice(1)).get('ticket');
    window.history.replaceState(null, '', window.location.pathname);
    if (!ticket) { setError('This sign-in link is not complete. Try again.'); return; }
    redeemTicket(ticket).then((result) => router.replace(result.next)).catch((caught) => setError(errorMessage(caught)));
  }, [router]);

  return (
    <div className="text-center">
      <h1 className="text-[26px] font-bold tracking-[-0.02em]">{error ? 'Sign-in did not finish' : 'Signing you in…'}</h1>
      {error ? (
        <>
          <p role="alert" className="mt-3 text-[15px] text-ink-2">{error}</p>
          <Link href="/login" className={`${btnPrimary} mt-6 h-12 w-full text-base`}>Back to sign in</Link>
        </>
      ) : (
        <span className="mx-auto mt-6 block h-8 w-8 animate-spin rounded-full border-[3px] border-brand-100 border-t-brand" aria-hidden="true" />
      )}
    </div>
  );
}
