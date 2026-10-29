'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/** The signed-in person, as returned by the API. */
export type SessionUser = { id: string; email: string; full_name: string | null; plan?: string; plan_name?: string; is_admin?: boolean };

const TOKEN_KEY = 'videmak_token';
const USER_KEY = 'videmak_user';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function read<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return read<string>(TOKEN_KEY);
}

export function setSession(token: string, user: SessionUser) {
  try {
    window.localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    // A non-secret marker so the server can redirect signed-in visitors; the token stays in storage.
    document.cookie = 'videmak_signed_in=1; path=/; max-age=2592000; samesite=lax';
  } catch { /* storage blocked: the session lasts for this page only */ }
  emit();
}

export function clearSession() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    document.cookie = 'videmak_signed_in=; path=/; max-age=0';
  } catch { /* ignore */ }
  emit();
}

let cachedUser: SessionUser | null | undefined;
function snapshot(): SessionUser | null {
  if (cachedUser === undefined) cachedUser = read<SessionUser>(USER_KEY);
  return cachedUser;
}
listeners.add(() => { cachedUser = undefined; });

/** Calls the Videmak API with the session token; throws an Error with the server's message. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.body && !(init.body instanceof FormData) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...init, headers });
  const body = await response.json().catch(() => null);
  if (response.status === 401 && token) clearSession();
  if (!response.ok) throw new Error((body && (body.detail || body.error)) || `Request failed (${response.status})`);
  return body as T;
}

const JUST_SIGNED_IN = 'videmak_offer_passkey';

/** Marks a sign-in with a password or a provider: the app then offers to add a passkey once. */
export function markSignedIn() {
  try { window.sessionStorage.setItem(JUST_SIGNED_IN, '1'); } catch { /* storage blocked */ }
}

export function hasSignedInMark(): boolean {
  try { return window.sessionStorage.getItem(JUST_SIGNED_IN) === '1'; } catch { return false; }
}

/** True once after such a sign-in (this tab). */
export function takeSignedInMark(): boolean {
  try {
    const marked = window.sessionStorage.getItem(JUST_SIGNED_IN) === '1';
    window.sessionStorage.removeItem(JUST_SIGNED_IN);
    return marked;
  } catch {
    return false;
  }
}

/** `turnstile_token`: the security check's answer, when Admin › Sign-in has Turnstile on. */
export async function signIn(email: string, password: string, turnstileToken?: string) {
  const result = await api<{ token: string; user: SessionUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password, turnstile_token: turnstileToken }) });
  setSession(result.token, result.user);
  markSignedIn();
  return result.user;
}

export async function signUp(input: { email: string; password: string; full_name: string; turnstile_token?: string }) {
  const result = await api<{ token: string; user: SessionUser }>('/api/auth/register', { method: 'POST', body: JSON.stringify(input) });
  setSession(result.token, result.user);
  markSignedIn();
  return result.user;
}

/** Reloads the person from the API (after a plan change). */
export async function refreshSession() {
  const token = getToken();
  if (!token) return;
  const fresh = await api<SessionUser>('/api/auth/me');
  setSession(token, fresh);
}

/** The current person (from storage, refreshed from /api/auth/me once per page load). */
export function useSession(): { user: SessionUser | null; loading: boolean } {
  const user = useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot,
    () => null,
  );
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api<SessionUser>('/api/auth/me')
      .then((fresh) => { const token = getToken(); if (token) setSession(token, fresh); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  return { user, loading };
}
