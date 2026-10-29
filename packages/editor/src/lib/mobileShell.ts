'use client';

import { useEffect, useSyncExternalStore } from 'react';

/** Keys of editor views that want the host's phone tab bar hidden (a full-screen document). */
const hiders = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function useHideMobileTabBar(key: string, hidden: boolean = true) {
  useEffect(() => {
    if (!hidden) return;
    hiders.add(key);
    emit();
    return () => { hiders.delete(key); emit(); };
  }, [key, hidden]);
}

/** For the host app: true while the editor wants the tab bar out of the way. */
export function useMobileTabBarHidden(): boolean {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => hiders.size > 0,
    () => false,
  );
}
