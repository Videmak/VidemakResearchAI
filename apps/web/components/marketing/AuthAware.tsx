'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { getToken } from '@/lib/session';

/**
 * Shows `signedIn` or `signedOut`. The server decides first from the `videmak_signed_in`
 * cookie (no flash); the browser then checks the session token in case the cookie is stale.
 */
export function AuthAware({ initial, signedIn, signedOut }: { initial: boolean; signedIn: ReactNode; signedOut: ReactNode }) {
  const [isSignedIn, setSignedIn] = useState(initial);
  useEffect(() => {
    const hasToken = Boolean(getToken());
    if (hasToken !== initial) setSignedIn(hasToken);
    // A cookie left behind without a session: drop it so the next page renders signed out.
    if (initial && !hasToken) document.cookie = 'videmak_signed_in=; path=/; max-age=0';
  }, [initial]);
  return <>{isSignedIn ? signedIn : signedOut}</>;
}
