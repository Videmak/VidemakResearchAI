import { getEditorConfig } from '../../runtime';

/** Base URL of the editor API ('' = same origin). */
export const getApiBase = (): string => (getEditorConfig().apiBase || '').replace(/\/+$/, '');

export const getAuthToken = (): string | null => {
  try { return getEditorConfig().getToken(); } catch { return null; }
};

export const hasToken = (): boolean => Boolean(getAuthToken());

export const getAuthHeader = (): Record<string, string> => {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};
