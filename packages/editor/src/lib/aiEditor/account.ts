'use client';

import { useEffect, useState } from 'react';
import { getApiBase, getAuthHeader, hasToken } from '../../utils/auth/api';

/** What the editor chrome needs to know about the signed-in person's account. */
export type EditorAccount = {
  name: string;
  email: string;
  plan: string;
  isAdmin: boolean;
};

let cached: { token: string; value: EditorAccount | null } | null = null;
let pending: Promise<EditorAccount | null> | null = null;

function loadAccount(): Promise<EditorAccount | null> {
  const header = getAuthHeader();
  const token = header.Authorization || '';
  if (!token) return Promise.resolve(null);
  if (cached && cached.token === token) return Promise.resolve(cached.value);
  if (pending) return pending;
  pending = fetch(`${getApiBase()}/api/auth/me`, { headers: header })
    .then((response) => (response.ok ? response.json() : null))
    .then((user) => {
      const value: EditorAccount | null = user
        ? {
            name: user.full_name || (user.email || '').split('@')[0] || '',
            email: user.email || '',
            plan: user.plan || 'free',
            isAdmin: Boolean(user.is_admin),
          }
        : null;
      cached = { token, value };
      return value;
    })
    .catch(() => null)
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** The person's plan and name (fetched once per session; null while signed out or loading). */
export function useEditorAccount(enabled = true): EditorAccount | null {
  const [account, setAccount] = useState<EditorAccount | null>(() => (cached && hasToken() ? cached.value : null));
  useEffect(() => {
    if (!enabled || !hasToken()) return;
    let alive = true;
    void loadAccount().then((value) => {
      if (alive) setAccount(value);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return account;
}

/** Paid plans hide the upgrade prompts. */
export function isPaidPlan(plan: string | null | undefined): boolean {
  return Boolean(plan) && plan !== 'free';
}
