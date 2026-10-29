'use client';

import { useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { VidemakEditorProvider, type VidemakEditorConfig } from '@videmak/editor';
import { getToken, useSession } from '@/lib/session';
import { openPricing } from '@/lib/billing';

/** Connects the editor package to this app: session, sign-in, upgrades and analytics. */
export function EditorHost({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const config = useMemo<VidemakEditorConfig>(() => ({
    apiBase: '',
    realtimeUrl: process.env.NEXT_PUBLIC_REALTIME_URL || undefined,
    getToken,
    user: user ? { id: user.id, email: user.email, full_name: user.full_name } : null,
    userLoading: loading,
    onRequireSignIn: () => {
      const here = `${pathname}${searchParams.toString() ? `?${searchParams}` : ''}`;
      router.push(`/login?next=${encodeURIComponent(here)}`);
    },
    onUpgrade: (info) => openPricing(info?.message ?? null),
    onEvent: () => {},
  }), [user, loading, pathname, searchParams, router]);

  return <VidemakEditorProvider config={config}>{children}</VidemakEditorProvider>;
}
