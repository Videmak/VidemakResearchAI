import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { sql } from '../db.js';
import { env } from '../env.js';

/**
 * Settings an admin can change from the browser. Each one overrides the server's
 * environment value of the same name; secrets are encrypted at rest and never sent
 * back in full (only whether they are set and their last 4 characters).
 */
export const SETTING_FIELDS = [
  { key: 'llmProvider', group: 'ai', label: 'AI provider', secret: false, options: ['', 'deepseek', 'videmak', 'openai', 'anthropic', 'openrouter', 'ollama'] },
  { key: 'llmApiKey', group: 'ai', label: 'AI API key', secret: true },
  { key: 'llmModel', group: 'ai', label: 'Fast model (autocomplete, edits, chat)', secret: false },
  { key: 'llmReviewModel', group: 'ai', label: 'Review model', secret: false },
  { key: 'llmBaseUrl', group: 'ai', label: 'Custom API base URL (optional)', secret: false },
  { key: 'papersProvider', group: 'papers', label: 'Papers from', secret: false, options: ['', 'scholar', 'videmak', 'openalex'], labels: { '': 'Scholar (default)', scholar: 'Scholar', videmak: 'Videmak Cloud key', openalex: 'OpenAlex' } },
  { key: 'scholarApiKey', group: 'papers', label: 'Scholar API key', secret: true, placeholder: 'oak_…', showWhen: { papersProvider: ['', 'scholar'] },
    link: { label: 'Get a free key', href: 'https://scholar.citedevidence.com/account/api-keys' },
    help: 'Sign in at scholar.citedevidence.com, open API keys, turn on Metadata, Files and Research, then paste the key here. 1,000 free credits a day.' },
  { key: 'openalexEmail', group: 'papers', label: 'Contact email for OpenAlex', secret: false },
  { key: 'videmakApiKey', group: 'cloud', label: 'Videmak Cloud key (self-hosted installs)', secret: true, placeholder: 'vm_live_…',
    link: { label: 'Get a key', href: 'https://videmak.net/developers' } },
  { key: 'cloudDeepseekKey', group: 'cloud', label: 'Gateway upstream DeepSeek key (Videmak Cloud)', secret: true },
  { key: 'cloudScholarKey', group: 'cloud', label: 'Gateway upstream Scholar key (Videmak Cloud)', secret: true },
  { key: 'cloudDailyFreeCredits', group: 'cloud', label: 'Free credits a day per account', secret: false, placeholder: '1000' },
  { key: 'cloudStarterCredits', group: 'cloud', label: 'One-time starter credits', secret: false, placeholder: '100' },
  { key: 'signinPassword', group: 'signin', label: 'Email and password', secret: false, kind: 'toggle', default: 'on' },
  { key: 'signinPasskeys', group: 'signin', label: 'Passkeys', secret: false, kind: 'toggle', default: 'on' },
  { key: 'signinGoogle', group: 'signin', label: 'Google', secret: false, kind: 'toggle', default: 'on' },
  { key: 'googleClientId', group: 'signin', label: 'Google client ID', secret: false },
  { key: 'googleClientSecret', group: 'signin', label: 'Google client secret', secret: true },
  { key: 'signinMicrosoft', group: 'signin', label: 'Microsoft', secret: false, kind: 'toggle', default: 'on' },
  { key: 'microsoftClientId', group: 'signin', label: 'Microsoft application (client) ID', secret: false },
  { key: 'microsoftClientSecret', group: 'signin', label: 'Microsoft client secret (Value)', secret: true },
  { key: 'signinApple', group: 'signin', label: 'Apple', secret: false, kind: 'toggle', default: 'on' },
  { key: 'appleServicesId', group: 'signin', label: 'Apple Services ID', secret: false },
  { key: 'appleTeamId', group: 'signin', label: 'Apple Team ID', secret: false },
  { key: 'appleKeyId', group: 'signin', label: 'Apple Key ID', secret: false },
  { key: 'applePrivateKey', group: 'signin', label: 'Apple private key (.p8)', secret: true },
  { key: 'signinTurnstile', group: 'signin', label: 'Cloudflare Turnstile', secret: false, kind: 'toggle', default: 'off' },
  { key: 'turnstileSiteKey', group: 'signin', label: 'Cloudflare Turnstile site key', secret: false },
  { key: 'turnstileSecretKey', group: 'signin', label: 'Cloudflare Turnstile secret key', secret: true },
  { key: 'storageProvider', group: 'storage', label: 'Store files on', secret: false, options: ['local', 'wasabi', 's3'], labels: { local: 'This server', wasabi: 'Wasabi', s3: 'Other S3-compatible' } },
  { key: 's3Region', group: 'storage', label: 'Region', secret: false, placeholder: 'eu-central-1', showWhen: { storageProvider: ['wasabi', 's3'] } },
  { key: 's3Bucket', group: 'storage', label: 'Bucket', secret: false, placeholder: 'videmak-files', showWhen: { storageProvider: ['wasabi', 's3'] } },
  { key: 's3AccessKeyId', group: 'storage', label: 'Access key', secret: true, showWhen: { storageProvider: ['wasabi', 's3'] } },
  { key: 's3SecretAccessKey', group: 'storage', label: 'Secret key', secret: true, showWhen: { storageProvider: ['wasabi', 's3'] } },
  { key: 's3Endpoint', group: 'storage', label: 'Endpoint URL', secret: false, placeholder: 'https://s3.example.com', showWhen: { storageProvider: ['s3'] } },
  { key: 's3UrlStyle', group: 'storage', label: 'Bucket address', secret: false, options: ['virtual', 'path'], labels: { virtual: 'In the host name', path: 'In the path (MinIO)' }, showWhen: { storageProvider: ['s3'] } },
  { key: 's3Prefix', group: 'storage', label: 'Folder in the bucket (optional)', secret: false, placeholder: 'videmak/', showWhen: { storageProvider: ['wasabi', 's3'] } },
  { key: 'mailProvider', group: 'email', label: 'Send emails with', secret: false, options: ['', 'smtp', 'resend'], labels: { '': 'Off', smtp: 'SMTP', resend: 'Resend' } },
  { key: 'mailFrom', group: 'email', label: 'From', secret: false, placeholder: 'Videmak <hello@videmak.net>', showWhen: { mailProvider: ['smtp', 'resend'] } },
  { key: 'mailReplyTo', group: 'email', label: 'Reply-to (optional)', secret: false, placeholder: 'support@videmak.net', showWhen: { mailProvider: ['smtp', 'resend'] } },
  { key: 'smtpHost', group: 'email', label: 'SMTP host', secret: false, placeholder: 'smtp.example.com', showWhen: { mailProvider: ['smtp'] } },
  { key: 'smtpPort', group: 'email', label: 'Port', secret: false, placeholder: '587', showWhen: { mailProvider: ['smtp'] } },
  { key: 'smtpSecurity', group: 'email', label: 'Security', secret: false, options: ['starttls', 'tls', 'none'], labels: { starttls: 'STARTTLS (port 587)', tls: 'TLS (port 465)', none: 'None' }, showWhen: { mailProvider: ['smtp'] } },
  { key: 'smtpUser', group: 'email', label: 'Username', secret: false, showWhen: { mailProvider: ['smtp'] } },
  { key: 'smtpPassword', group: 'email', label: 'Password', secret: true, showWhen: { mailProvider: ['smtp'] } },
  { key: 'resendApiKey', group: 'email', label: 'Resend API key', secret: true, showWhen: { mailProvider: ['resend'] } },
  { key: 'newsletterProvider', group: 'newsletter', label: 'Send newsletters with', secret: false, options: ['', 'mailcheap'], labels: { '': 'Off', mailcheap: 'MailCheap' } },
  { key: 'mailcheapApiKey', group: 'newsletter', label: 'MailCheap API key', secret: true, showWhen: { newsletterProvider: ['mailcheap'] } },
  { key: 'mailcheapNewsletter', group: 'newsletter', label: 'Newsletter slug (optional)', secret: false, placeholder: 'Your default newsletter', showWhen: { newsletterProvider: ['mailcheap'] } },
  { key: 'stripeSecretKey', group: 'billing', label: 'Stripe secret key', secret: true, placeholder: 'sk_test_… (sk_live_… needs BILLING_LIVE=1)' },
  { key: 'stripeWebhookSecret', group: 'billing', label: 'Stripe webhook signing secret', secret: true },
] as const;

export type SettingKey = (typeof SETTING_FIELDS)[number]['key'];
export type EffectiveSettings = typeof env;

let overrides: Partial<Record<SettingKey, string>> = {};
let version = 0;
const listeners = new Set<() => void>();

function cipherKey() {
  // Prefer a dedicated key; fall back to one derived from the session secret.
  return createHash('sha256').update(`videmak-settings:${env.settingsKey || env.jwtSecret}`).digest();
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cipherKey(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
}

function decrypt(stored: string) {
  const [iv, tag, data] = stored.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', cipherKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Loads saved overrides from the database (at start-up and after every change). */
export async function loadSettings() {
  const rows = await sql<{ key: SettingKey; value_encrypted: string }[]>`select key, value_encrypted from app_settings`;
  const next: Partial<Record<SettingKey, string>> = {};
  for (const row of rows) {
    try { next[row.key] = decrypt(row.value_encrypted); } catch { console.error(`setting ${row.key} could not be decrypted (was SETTINGS_KEY changed?)`); }
  }
  overrides = next;
  version += 1;
  listeners.forEach((listener) => listener());
}

/** The settings in force: admin overrides first, then the server environment. */
export function settings(): EffectiveSettings {
  return { ...env, ...overrides } as EffectiveSettings;
}

export function settingsVersion() {
  return version;
}

export function onSettingsChange(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Saves (or with null, clears) settings, then reloads them for every request. */
export async function saveSettings(values: Partial<Record<SettingKey, string | null>>, userId: string) {
  const known = new Set<string>(SETTING_FIELDS.map((field) => field.key));
  for (const [key, raw] of Object.entries(values)) {
    if (!known.has(key)) continue;
    const value = typeof raw === 'string' ? raw.trim() : null;
    if (value) {
      await sql`insert into app_settings (key, value_encrypted, updated_by) values (${key}, ${encrypt(value)}, ${userId})
        on conflict (key) do update set value_encrypted = excluded.value_encrypted, updated_by = excluded.updated_by, updated_at = now()`;
    } else {
      await sql`delete from app_settings where key = ${key}`;
    }
    await sql`insert into admin_audit (user_id, action, target) values (${userId}, ${value ? 'setting_saved' : 'setting_cleared'}, ${key})`;
  }
  await loadSettings();
}

/** What the admin page may see: set or not, where it comes from, and a masked preview. */
export function describeSettings() {
  const effective = settings() as unknown as Record<string, unknown>;
  return SETTING_FIELDS.map((field) => {
    const value = String(effective[field.key] ?? '');
    const source = overrides[field.key] ? 'admin' : value ? 'server' : 'unset';
    return {
      key: field.key,
      group: field.group,
      label: field.label,
      secret: field.secret,
      options: 'options' in field ? field.options : undefined,
      labels: 'labels' in field ? field.labels : undefined,
      placeholder: 'placeholder' in field ? field.placeholder : undefined,
      // Shown only while another setting in the group has one of these values.
      show_when: 'showWhen' in field ? field.showWhen : undefined,
      // Where to get the value, and a one-line how-to.
      link: 'link' in field ? field.link : undefined,
      help: 'help' in field ? field.help : undefined,
      // 'toggle': the value is 'on' or 'off'; unset means `default`.
      kind: 'kind' in field ? field.kind : undefined,
      default: 'default' in field ? field.default : undefined,
      set: Boolean(value),
      source,
      value: field.secret ? (value ? `••••${value.slice(-4)}` : '') : value,
    };
  });
}
