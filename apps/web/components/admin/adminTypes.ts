/** Shapes returned by /api/admin/settings and /api/admin/overview (see apps/server/src/routes/admin.ts). */

export type Setting = {
  key: string; group: string; label: string; secret: boolean; options?: string[]; set: boolean;
  source: 'admin' | 'server' | 'unset'; value: string;
  /** Words for `options` ('' → 'Off'), a placeholder, and when the field shows (another field's values). */
  labels?: Record<string, string>; placeholder?: string; show_when?: Record<string, string[]>;
  /** Where to get the value, and a one-line how-to (shown until it is set). */
  link?: { label: string; href: string }; help?: string;
  /** 'toggle': the value is 'on' or 'off'; unset means `default`. */
  kind?: string; default?: string | boolean | null;
};

export type TestResult = { ok: boolean; [key: string]: unknown };

export type AuditEntry = { action: string; target: string; created_at: string; email: string | null };

export type Overview = {
  counts: { users: number; documents: number; library: number; keys: number };
  usage: { service: string; quantity: number }[];
  audit: AuditEntry[];
};

export type Webhook = { url: string; events: string[] };

export type Notice = { tone: 'ok' | 'error'; text: string } | null;

/** Fields that apply to the provider chosen in the group (a draft choice counts before it is saved). */
export function visibleFields(fields: Setting[], draft: Record<string, string> = {}) {
  const current = (key: string) => draft[key] ?? fields.find((field) => field.key === key)?.value ?? '';
  return fields.filter((field) => !field.show_when || Object.entries(field.show_when).every(([key, values]) => values.includes(current(key))));
}

export const isOn = (setting: Setting) => {
  const value = setting.set ? setting.value : setting.default;
  return value === true || value === 'on' || value === 'true';
};

export const when = (value: string) => new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** "plan_saved" → "Plan saved". */
export const words = (value: string) => value.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
