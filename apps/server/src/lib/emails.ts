import type { Mail } from './mail.js';

/** The few account emails Videmak sends, as HTML (inline styles, for mail apps) and plain text. */

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function layout(input: { to: string; subject: string; heading: string; lines: string[]; button?: { label: string; url: string }; note?: string }): Mail {
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";
  const paragraphs = input.lines.map((line) => `<p style="margin:0 0 14px;font:15px/1.6 ${font};color:#334155">${escape(line)}</p>`).join('');
  const button = input.button
    ? `<p style="margin:22px 0 4px"><a href="${escape(input.button.url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font:600 15px/1 ${font};padding:13px 20px;border-radius:10px">${escape(input.button.label)}</a></p>
       <p style="margin:14px 0 0;font:12.5px/1.6 ${font};color:#94a3b8;word-break:break-all">Or paste this link: ${escape(input.button.url)}</p>`
    : '';
  const note = input.note ? `<p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #f1f5f9;font:13px/1.6 ${font};color:#64748b">${escape(input.note)}</p>` : '';
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 18px;font:800 19px/1 ${font};color:#0f172a;letter-spacing:-0.02em"><span style="display:inline-block;width:24px;height:24px;border-radius:7px;background:#2563eb;color:#fff;text-align:center;font:700 14px/24px ${font};margin-right:8px;vertical-align:middle">V</span><span style="vertical-align:middle">videmak</span></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:28px 28px 26px">
<h1 style="margin:0 0 14px;font:700 21px/1.3 ${font};color:#0f172a;letter-spacing:-0.01em">${escape(input.heading)}</h1>
${paragraphs}${button}${note}
</td></tr></table></td></tr></table></body></html>`;
  const text = [input.heading, '', ...input.lines, ...(input.button ? ['', `${input.button.label}: ${input.button.url}`] : []), ...(input.note ? ['', input.note] : [])].join('\n');
  return { to: input.to, subject: input.subject, html, text };
}

export function passwordResetEmail(to: string, url: string) {
  return layout({
    to, subject: 'Reset your Videmak password', heading: 'Reset your password',
    lines: [`Someone asked to reset the password for ${to}. The link works for one hour.`],
    button: { label: 'Choose a new password', url },
    note: "Didn't ask for this? Ignore this email. Your password stays the same.",
  });
}

export function confirmEmail(to: string, url: string) {
  return layout({
    to, subject: 'Confirm your email for Videmak', heading: 'Confirm your email',
    lines: [`Confirm ${to} to finish setting up your Videmak account.`],
    button: { label: 'Confirm email', url },
    note: "Didn't create an account? Ignore this email.",
  });
}

export function testEmail(to: string, provider: string) {
  return layout({
    to, subject: 'Videmak test email', heading: 'Email works',
    lines: [`This test was sent with ${provider} from Admin › Email.`],
  });
}

export function lowCreditsEmail(to: string, credits: number, url: string) {
  return layout({
    to, subject: 'Your Videmak credits are running low', heading: 'Credits running low',
    lines: [`Your Videmak Cloud balance is ${Math.max(0, Math.floor(credits)).toLocaleString('en-US')} credits. Calls that need paid credits stop when it reaches zero.`],
    button: { label: 'Buy credits', url },
    note: 'Turn on automatic top-up on the same page to never run out.',
  });
}

export function topUpFailedEmail(to: string, reason: string, url: string) {
  return layout({
    to, subject: 'Videmak automatic top-up failed', heading: 'Automatic top-up failed',
    lines: [`We could not add credits to your Videmak Cloud balance: ${reason}`, 'Automatic top-up is now off.'],
    button: { label: 'Check your card', url },
  });
}
