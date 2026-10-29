'use client';

import { useEditorConfig } from '../../runtime';

/** The editor's view of the signed-in person, supplied by the host app. */
export function useAuth() {
  const config = useEditorConfig();
  const user = config.user
    ? { ...config.user, id: config.user.id as unknown as number, full_name: config.user.full_name ?? null, username: config.user.username ?? config.user.email }
    : null;
  return {
    user: user as any,
    loading: Boolean(config.userLoading),
    isAuthenticated: Boolean(config.user),
    login: async () => { config.onRequireSignIn?.(); },
    logout: async () => {},
  };
}
