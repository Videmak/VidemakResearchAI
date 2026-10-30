/** Server settings, read once from the environment. */
const read = (name: string, fallback = '') => (process.env[name] ?? fallback).trim();

export const env = {
  port: Number(read('PORT', '4000')),
  publicUrl: read('PUBLIC_URL', 'http://localhost:3000').replace(/\/+$/, ''),
  databaseUrl: read('DATABASE_URL', 'postgres://videmak:videmak@localhost:5432/videmak'),
  valkeyUrl: read('VALKEY_URL', 'redis://localhost:6379'),
  jwtSecret: read('JWT_SECRET'),
  filesDir: read('FILES_DIR', './data/files'),
  convertUrl: read('CONVERT_URL', 'http://localhost:4100').replace(/\/+$/, ''),
  /** How other internal services (the converter) reach this server. */
  internalUrl: read('INTERNAL_URL', 'http://localhost:4000').replace(/\/+$/, ''),

  /** One key turns every slot on; any slot can be overridden below. */
  videmakApiKey: read('VIDEMAK_API_KEY'),
  videmakApiUrl: read('VIDEMAK_API_URL', 'https://new.videmak.net').replace(/\/+$/, ''),

  llmProvider: read('LLM_PROVIDER'),          // videmak | deepseek | openai | anthropic | openrouter | ollama
  llmApiKey: read('LLM_API_KEY'),
  llmBaseUrl: read('LLM_BASE_URL'),
  llmModel: read('LLM_MODEL'),                // fast model: autocomplete, edits, chat
  llmReviewModel: read('LLM_REVIEW_MODEL'),   // stronger model: reviews

  papersProvider: read('PAPERS_PROVIDER'),    // scholar (default) | videmak | openalex
  scholarUrl: read('SCHOLAR_URL', 'https://scholar.citedevidence.com').replace(/\/+$/, ''),
  scholarApiKey: read('SCHOLAR_API_KEY'),
  openalexEmail: read('OPENALEX_EMAIL'),
  /** Where people write when they are stuck (sign-in help); hidden when empty. */
  supportEmail: read('SUPPORT_EMAIL'),

  /** Videmak Cloud upstreams and credits (only on the server that runs the paid gateway). */
  cloudDeepseekKey: read('CLOUD_DEEPSEEK_API_KEY'),
  cloudScholarKey: read('CLOUD_SCHOLAR_API_KEY'),
  cloudPapersUrl: read('CLOUD_PAPERS_URL', 'https://api.openalex.org').replace(/\/+$/, ''),
  cloudDailyFreeCredits: read('CLOUD_DAILY_FREE_CREDITS', '1000'),
  cloudStarterCredits: read('CLOUD_STARTER_CREDITS', '100'),

  /** People who may open the admin page (comma-separated emails). */
  adminEmails: read('ADMIN_EMAILS').toLowerCase().split(',').map((value) => value.trim()).filter(Boolean),
  /** Encrypts keys saved from the admin page (32+ characters). */
  settingsKey: read('SETTINGS_KEY'),

  /** Sign-in methods: 'on'/'off' switches (Admin › Sign-in) and each provider's keys. */
  signinPassword: read('SIGNIN_PASSWORD', 'on'),
  googleRedirectUri: read('GOOGLE_REDIRECT_URI'),
  /** Zotero sign-in (optional OAuth app from zotero.org/oauth/apps; API keys work without it). */
  zoteroClientKey: read('ZOTERO_CLIENT_KEY'),
  zoteroClientSecret: read('ZOTERO_CLIENT_SECRET'),
  /** Mendeley import (OAuth app from dev.mendeley.com). */
  mendeleyClientId: read('MENDELEY_CLIENT_ID'),
  mendeleyClientSecret: read('MENDELEY_CLIENT_SECRET'),
  signinPasskeys: read('SIGNIN_PASSKEYS', 'on'),
  signinGoogle: read('SIGNIN_GOOGLE', 'on'),
  googleClientId: read('GOOGLE_CLIENT_ID'),
  googleClientSecret: read('GOOGLE_CLIENT_SECRET'),
  signinMicrosoft: read('SIGNIN_MICROSOFT', 'on'),
  microsoftClientId: read('MICROSOFT_CLIENT_ID'),
  microsoftClientSecret: read('MICROSOFT_CLIENT_SECRET'),
  signinApple: read('SIGNIN_APPLE', 'on'),
  appleServicesId: read('APPLE_SERVICES_ID'),
  appleTeamId: read('APPLE_TEAM_ID'),
  appleKeyId: read('APPLE_KEY_ID'),
  applePrivateKey: read('APPLE_PRIVATE_KEY'),
  /** Cloudflare Turnstile on the sign-in form (optional: both keys turn it on). */
  signinTurnstile: read('SIGNIN_TURNSTILE', 'off'),
  turnstileSiteKey: read('TURNSTILE_SITE_KEY'),
  turnstileSecretKey: read('TURNSTILE_SECRET_KEY'),

  /** Where uploads live: 'local' (FILES_DIR), 'wasabi', or 's3' for any S3-compatible store. */
  storageProvider: read('STORAGE_PROVIDER', 'local'),
  s3Region: read('S3_REGION'),
  s3Bucket: read('S3_BUCKET'),
  s3AccessKeyId: read('S3_ACCESS_KEY_ID'),
  s3SecretAccessKey: read('S3_SECRET_ACCESS_KEY'),
  s3Endpoint: read('S3_ENDPOINT'),
  /** 'virtual' (bucket in the host name) or 'path' (bucket in the path, as MinIO needs). */
  s3UrlStyle: read('S3_URL_STYLE', 'virtual'),
  s3Prefix: read('S3_PREFIX'),

  /** Account emails (password reset, email confirmation): 'smtp' or 'resend'; empty sends none. */
  mailProvider: read('MAIL_PROVIDER'),
  mailFrom: read('MAIL_FROM'),
  mailReplyTo: read('MAIL_REPLY_TO'),
  smtpHost: read('SMTP_HOST'),
  smtpPort: read('SMTP_PORT', '587'),
  /** 'starttls' (usually port 587), 'tls' (port 465) or 'none'. */
  smtpSecurity: read('SMTP_SECURITY', 'starttls'),
  smtpUser: read('SMTP_USER'),
  smtpPassword: read('SMTP_PASSWORD'),
  resendApiKey: read('RESEND_API_KEY'),

  /** Newsletter: 'mailcheap' keeps a MailCheap list in step with Videmak accounts. */
  newsletterProvider: read('NEWSLETTER_PROVIDER'),
  mailcheapApiKey: read('MAILCHEAP_API_KEY'),
  mailcheapNewsletter: read('MAILCHEAP_NEWSLETTER'),

  stripeSecretKey: read('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: read('STRIPE_WEBHOOK_SECRET'),
  /** Real payments: only with BILLING_LIVE=1 in the server's environment (never from the admin page). */
  billingLive: read('BILLING_LIVE') === '1',
};

if (!env.jwtSecret || env.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be set to at least 32 characters.');
}
