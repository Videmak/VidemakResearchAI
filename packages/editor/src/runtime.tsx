'use client';

import React, { createContext, useContext, useEffect, useSyncExternalStore } from 'react';

/** The signed-in person as the host app knows them. */
export type VidemakUser = {
  id: string;
  email: string;
  full_name?: string | null;
  username?: string | null;
};

/**
 * Everything the editor needs from the app it runs in. The editor never talks to
 * accounts, plans or billing directly: the host decides through these hooks.
 */
export type VidemakEditorConfig = {
  /** Base URL of the editor API; '' means the same origin as the page. */
  apiBase: string;
  /** WebSocket URL of the real-time sync server; defaults to `${origin}/collab`. */
  realtimeUrl?: string;
  /** Returns a short-lived token for the current person, or null when signed out. */
  getToken: () => string | null;
  user: VidemakUser | null;
  userLoading?: boolean;
  /** A signed-out visitor tried an action that needs an account. */
  onRequireSignIn?: (reason?: string) => void;
  /** A service answered "payment required" or the person asked to upgrade. */
  onUpgrade?: (info?: { reason?: string; message?: string }) => void;
  /** Analytics hook; never receives document text. */
  onEvent?: (name: string, properties?: Record<string, unknown>) => void;
  /** Route the editor lives at in the host app (default '/editor'); links to documents use it. */
  editorPath?: string;
  /**
   * Optional app navigation for the 232px column left of the editor on wide screens. Without
   * it the editor draws its own (Documents, Library, Find papers, AI Chat, recent documents).
   */
  renderNavigation?: () => React.ReactNode;
  /** Host routes the built-in navigation links to (defaults: /library, /papers, /chat, /account, /help, /pricing, /admin). */
  navLinks?: Partial<Record<'home' | 'library' | 'papers' | 'chat' | 'account' | 'help' | 'pricing' | 'admin', string>>;
};

/** Host route for one of the built-in navigation links. */
export function navLink(name: keyof NonNullable<VidemakEditorConfig['navLinks']>): string {
  const defaults = { home: '/', library: '/library', papers: '/papers', chat: '/chat', account: '/account', help: '/help', pricing: '/pricing', admin: '/admin' };
  return currentConfig.navLinks?.[name] || defaults[name];
}

const fallbackConfig: VidemakEditorConfig = { apiBase: '', getToken: () => null, user: null };
let currentConfig: VidemakEditorConfig = fallbackConfig;
const listeners = new Set<() => void>();

/** Module-level access for non-React helpers (fetch wrappers, providers). */
export function getEditorConfig(): VidemakEditorConfig {
  return currentConfig;
}

function setEditorConfig(next: VidemakEditorConfig) {
  if (next === currentConfig) return;
  currentConfig = next;
  listeners.forEach((listener) => listener());
}

const ConfigContext = createContext<VidemakEditorConfig>(fallbackConfig);

/** Wrap the editor (or the whole app) once; updates flow to every editor helper. */
export function VidemakEditorProvider({ config, children }: { config: VidemakEditorConfig; children: React.ReactNode }) {
  // Set synchronously so helpers called during the first render see the config.
  if (typeof window !== 'undefined') currentConfig = config;
  useEffect(() => { setEditorConfig(config); }, [config]);
  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

export function useEditorConfig(): VidemakEditorConfig {
  return useContext(ConfigContext);
}

/** Subscribe to config changes outside React context (rarely needed). */
export function useEditorConfigSnapshot(): VidemakEditorConfig {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => currentConfig,
    () => fallbackConfig,
  );
}

/** The host route of the editor, e.g. '/editor'. */
export function editorPath(): string {
  return (currentConfig.editorPath || '/editor').replace(/\/+$/, '') || '/editor';
}

export function emitEditorEvent(name: string, properties?: Record<string, unknown>) {
  try { currentConfig.onEvent?.(name, properties); } catch { /* analytics must never break editing */ }
}
