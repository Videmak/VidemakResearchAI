'use client';

import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api, markSignedIn, setSession, type SessionUser } from '@/lib/session';

/** Sign-in methods in the browser: which exist, Google/Microsoft/Apple round trips, passkeys. */

export type Provider = 'google' | 'microsoft' | 'apple';
/** `turnstile_site_key`: set when the sign-in form shows Cloudflare's security check; `password_reset`: email is set up. */
export type Methods = { password: boolean; passkeys: boolean; turnstile_site_key?: string | null; password_reset?: boolean; support_email?: string | null } & Record<Provider, boolean>;
export const PROVIDERS: Provider[] = ['google', 'microsoft', 'apple'];
export const PROVIDER_NAMES: Record<Provider, string> = { google: 'Google', microsoft: 'Microsoft', apple: 'Apple' };

let methodsRequest: Promise<Methods> | null = null;
export function getMethods(): Promise<Methods> {
  methodsRequest ||= api<Methods>('/api/auth/methods').catch((error) => {
    methodsRequest = null;
    throw error;
  });
  return methodsRequest;
}

/** What an email can do next. `linked`: the account is connected to `providers`. */
export type Identify = {
  next_step: 'password' | 'signup' | 'provider'; providers: Provider[]; password_available: boolean; passkey_available: boolean;
  account_exists?: boolean; linked?: boolean;
};
export const identify = (email: string, turnstileToken?: string) =>
  api<Identify>('/api/auth/identify', { method: 'POST', body: JSON.stringify({ email, turnstile_token: turnstileToken }) });

// A random value only this browser knows: finishing a provider sign-in needs it (stops login CSRF).
const BINDING_KEY = 'videmak-signin-binding';

function newBinding() {
  const value = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(BINDING_KEY, value); } catch { /* storage blocked: the sign-in cannot finish */ }
  return value;
}

export function takeBinding(): string | null {
  try {
    const value = localStorage.getItem(BINDING_KEY);
    localStorage.removeItem(BINDING_KEY);
    return value;
  } catch {
    return null;
  }
}

/** Sends the browser to the provider; `connect` adds it to the signed-in account. */
export async function startProvider(provider: Provider, options: { mode?: 'signin' | 'connect'; next?: string } = {}) {
  const mode = options.mode ?? 'signin';
  const { authorization_url } = await api<{ authorization_url: string }>(`/api/auth/oauth/${provider}/start`, {
    method: 'POST',
    body: JSON.stringify({ mode, next: options.next, binding: mode === 'signin' ? newBinding() : undefined }),
  });
  window.location.assign(authorization_url);
}

/** Back from the provider: trades the one-time ticket for a session. */
export async function redeemTicket(ticket: string) {
  const result = await api<{ token: string; user: SessionUser; next: string }>('/api/auth/ticket', {
    method: 'POST', body: JSON.stringify({ ticket, binding: takeBinding() }),
  });
  setSession(result.token, result.user);
  markSignedIn();
  return result;
}

export const passkeysSupported = () => typeof window !== 'undefined' && browserSupportsWebAuthn();
export const passkeyAutofillSupported = () => browserSupportsWebAuthnAutofill().catch(() => false);

/** True when the person closed the passkey prompt (not an error worth showing). */
export function passkeyCancelled(error: unknown) {
  const name = (error as { name?: string })?.name;
  return name === 'NotAllowedError' || name === 'AbortError' || /cancel|abort|not allowed/i.test((error as Error)?.message || '');
}

/** Signs in with a saved passkey (or, with autofill, when one is picked in the email field). */
export async function signInWithPasskey(autofill = false) {
  const { flow, options } = await api<{ flow: string; options: any }>('/api/auth/passkeys/login/options', { method: 'POST' });
  const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill });
  const result = await api<{ token: string; user: SessionUser }>('/api/auth/passkeys/login/verify', { method: 'POST', body: JSON.stringify({ flow, response }) });
  setSession(result.token, result.user);
  return result.user;
}

/** Saves a new passkey on the signed-in account. */
export async function addPasskey() {
  const { flow, options } = await api<{ flow: string; options: any }>('/api/auth/passkeys/register/options', { method: 'POST' });
  const response = await startRegistration({ optionsJSON: options });
  return api<{ passkey: { id: string; name: string } }>('/api/auth/passkeys/register/verify', { method: 'POST', body: JSON.stringify({ flow, response }) });
}

export type MyMethods = {
  password: boolean;
  providers: Record<Provider, { connected: boolean; email: string | null }>;
  passkeys: { id: string; name: string; created_at: string; last_used_at: string | null; backed_up: boolean }[];
  available: Methods;
};
export const getMyMethods = () => api<MyMethods>('/api/auth/sign-in-methods/me');
