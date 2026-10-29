import { createTransport, type Transporter } from 'nodemailer';
import { settings, settingsVersion, type EffectiveSettings } from './settings.js';

/**
 * Account emails (password reset, email confirmation) through SMTP or Resend, chosen in
 * Admin › Email. With neither set up nothing is sent and the features that need email hide.
 */

export type Mail = { to: string; subject: string; text: string; html: string };

const RESEND_URL = 'https://api.resend.com/emails';

export function mailProvider(s: EffectiveSettings = settings()): 'smtp' | 'resend' | null {
  if (!s.mailFrom) return null;
  if (s.mailProvider === 'smtp' && s.smtpHost) return 'smtp';
  if (s.mailProvider === 'resend' && s.resendApiKey) return 'resend';
  return null;
}

/** Whether emails can be sent (a provider, its keys and a From address are set). */
export const mailReady = (s: EffectiveSettings = settings()) => mailProvider(s) !== null;

let smtp: { version: number; transport: Transporter } | null = null;

export function smtpOptions(s: EffectiveSettings) {
  const port = Number(s.smtpPort) || (s.smtpSecurity === 'tls' ? 465 : 587);
  return {
    host: s.smtpHost,
    port,
    secure: s.smtpSecurity === 'tls',
    requireTLS: s.smtpSecurity === 'starttls',
    ignoreTLS: s.smtpSecurity === 'none',
    auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPassword } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  };
}

function smtpTransport(s: EffectiveSettings) {
  const version = settingsVersion();
  if (smtp?.version !== version) {
    smtp?.transport.close();
    smtp = { version, transport: createTransport(smtpOptions(s)) };
  }
  return smtp.transport;
}

/** Resend's JSON body for one message. */
export function resendBody(mail: Mail, s: EffectiveSettings) {
  return { from: s.mailFrom, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text, ...(s.mailReplyTo ? { reply_to: s.mailReplyTo } : {}) };
}

/** Sends one email; throws with the provider's own message when it is refused. */
export async function sendMail(mail: Mail): Promise<{ provider: 'smtp' | 'resend'; id: string | null }> {
  const s = settings();
  const provider = mailProvider(s);
  if (!provider) throw new Error('Email is not set up. Choose SMTP or Resend in Admin › Email and add a From address.');
  if (provider === 'resend') {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(resendBody(mail, s)),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null;
    if (!response.ok) throw new Error(`Resend refused the email (${response.status}): ${body?.message || body?.name || 'no details'}`);
    return { provider, id: body?.id ?? null };
  }
  const info = await smtpTransport(s).sendMail({
    from: s.mailFrom, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html,
    ...(s.mailReplyTo ? { replyTo: s.mailReplyTo } : {}),
  });
  return { provider, id: info.messageId ?? null };
}
