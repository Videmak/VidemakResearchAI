import { emitEditorEvent } from '../runtime';

/** Editor analytics, handed to the host app's onEvent. Never includes document text. */
const moduleAnalytics = {
  track: (payload: Record<string, any>) => emitEditorEvent(String(payload?.action || payload?.event || 'event'), payload),
  completed: (module: string, action: string, metadata?: Record<string, any>) =>
    emitEditorEvent(`${action}_completed`, { module, ...(metadata || {}) }),
  failed: (module: string, action: string, code?: string, _error?: unknown, metadata?: Record<string, any>) =>
    emitEditorEvent(`${action}_failed`, { module, code, ...(metadata || {}) }),
};

export { moduleAnalytics };
export default moduleAnalytics;
