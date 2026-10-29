'use client';

import { useSyncExternalStore } from 'react';

/** Documents, Library and Find papers slide in from the left in place of the app menu; AI Chat opens on the right. */
export type SideloadDrawer = 'documents' | 'library' | 'papers';
export type SideloadTool = SideloadDrawer | 'chat';

export type SideloadState = {
  drawer: SideloadDrawer | null;
  chat: boolean;
  /** The app menu shown beside the drawer (by default the drawer takes its place). */
  menu: boolean;
  /** Library sources handed to the AI Chat ("Ask" on a source). */
  mentions: { id: string; title: string }[];
};

let state: SideloadState = { drawer: null, chat: false, menu: false, mentions: [] };
const listeners = new Set<() => void>();
const set = (patch: Partial<SideloadState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};

/** From a menu: opens the tool, or closes it when it is already open. */
export function toggleSideload(tool: SideloadTool) {
  if (tool === 'chat') set({ chat: !state.chat });
  else set({ drawer: state.drawer === tool ? null : tool });
}

/** Opens the tool (a link such as /editor?tool=papers, or switching inside the drawer). */
export function showSideload(tool: SideloadTool) {
  if (tool === 'chat') set({ chat: true });
  else set({ drawer: tool });
}

export function closeSideloadDrawer() {
  set({ drawer: null, menu: false });
}

export function closeSideloadChat() {
  set({ chat: false });
}

export function setSideloadMenu(menu: boolean) {
  set({ menu });
}

/** "Ask" on a Library source: the AI Chat opens with that source attached. */
export function askAboutInSideloadChat(source: { id: string; title: string }) {
  set({ chat: true, mentions: state.mentions.some((item) => item.id === source.id) ? state.mentions : [...state.mentions, source] });
}

export function setSideloadMentions(mentions: SideloadState['mentions']) {
  set({ mentions });
}

const initial = state;
export function useSideloads(): SideloadState {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => state,
    () => initial,
  );
}
