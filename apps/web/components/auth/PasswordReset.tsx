'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LuCircleCheck, LuMailCheck } from 'react-icons/lu';
import { api, markSignedIn, setSession, type SessionUser } from '@/lib/session';
import { getMethods, type Methods } from '@/lib/signin';
import { btnGhost, btnPrimary, focusRing } from '@/components/marketing/styles';
import { AuthCard } from './AuthCard';
import { Turnstile } from './Turnstile';
import { EMAIL_PATTERN, Field, MIN_PASSWORD_LENGTH, PasswordInput, errorMessage, inputClass, useQueryParams } from './fields';

const linkClass = `rounded font-semibold text-brand hover:text-brand-600 ${focusRing}`;
const BackToSignIn = ({ label = 'Back to sign in' }: { label?: string }) => (
  <p className="mt-6 text-center text-[14.5px] text-ink-2"><Link href="/login" className={linkClass}>{label}</Link></p>
);
const Alert = ({ text }: { text: string }) => text ? <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700">{text}</p> : null;

/** The token from a link like /reset-password#token=… (kept out of server logs by the #). */
function useHashToken() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setToken(new URLSearchParams(window.location.hash.slice(1)).get('token'));
    // Out of the address bar, so it isn't shared or kept in history by accident.
    window.history.replaceState(null, '', window.location.pathname);
  }, []);
  return token;
}

/** Asks for the email and sends the reset link (when Videmak can send email). */
export function ForgotPasswordForm() {
  const params = useQueryParams();
  const [methods, setMethods] = useState<Methods | null>(null);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [proof, setProof] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => { getMethods().then(setMethods).catch(() => setMethods(null)); }, []);
  useEffect(() => { const given = params?.get('email'); if (given) setEmail((current) => current || given); }, [params]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setFieldError('');
    const address = email.trim();
    if (!EMAIL_PATTERN.test(address)) { setFieldError('Enter a valid email address.'); emailRef.current?.focus(); return; }
    if (methods?.turnstile_site_key && !proof) { setError('Finish the security check, then try again.'); return; }
    setBusy(true);
    try {
      await api('/api/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email: address, turnstile_token: proof ?? undefined }) });
      setSent(address);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally { setBusy(false); }
  };

  if (methods && !methods.password_reset) {
    return (
      <AuthCard title="Reset your password">
        <p className="-mt-3 text-center text-[15px] leading-[1.6] text-ink-2">
          {methods.support_email ? (
            <>Email <a href={`mailto:${methods.support_email}?subject=Reset%20my%20password`} className={linkClass}>{methods.support_email}</a> from the address you signed up with and we will help you back in.</>
          ) : 'Password reset by email is not set up here. Ask the site admin for help.'}
        </p>
        <BackToSignIn />
      </AuthCard>
    );
  }

  if (sent) {
    return (
      <AuthCard title="Check your email">
        <div className="-mt-1 flex flex-col items-center text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand"><LuMailCheck size={22} aria-hidden="true" /></span>
          <p className="mt-4 text-[15px] leading-[1.6] text-ink-2">If <strong className="font-semibold text-ink">{sent}</strong> has a Videmak account, a reset link is on its way. It works for one hour.</p>
        </div>
        <button type="button" onClick={() => { setSent(null); setProof(null); }} className={`${btnGhost} mt-6 h-12 w-full text-base`}>Use another email</button>
        <BackToSignIn />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      <Alert text={error} />
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-busy={busy}>
        <Field id="forgot-email" label="Email address" error={fieldError}>
          <input ref={emailRef} id="forgot-email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
            required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? 'forgot-email-error' : undefined} className={inputClass} placeholder="you@university.edu" />
        </Field>
        {methods?.turnstile_site_key && <Turnstile siteKey={methods.turnstile_site_key} onToken={setProof} onError={setError} />}
        <button type="submit" disabled={busy || !methods} className={`${btnPrimary} h-12 w-full text-base`}>{busy ? 'Sending…' : 'Send reset link'}</button>
      </form>
      <BackToSignIn label="Remembered it? Sign in" />
    </AuthCard>
  );
}

/** Opened from the emailed link: choose a new password, then go straight in. */
export function ResetPasswordForm() {
  const router = useRouter();
  const token = useHashToken();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setFieldError('');
    if (password.length < MIN_PASSWORD_LENGTH) { setFieldError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`); passwordRef.current?.focus(); return; }
    setBusy(true);
    try {
      const result = await api<{ token: string; user: SessionUser }>('/api/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
      setSession(result.token, result.user);
      markSignedIn();
      router.replace('/editor');
    } catch (caught) {
      const message = errorMessage(caught);
      if (/expired|already used/i.test(message)) setExpired(true); else setError(message);
      setBusy(false);
    }
  };

  if (token === undefined) return null;
  if (!token || expired) {
    return (
      <AuthCard title="This link has expired">
        <p className="-mt-3 text-center text-[15px] leading-[1.6] text-ink-2">Reset links work for one hour and only once. Ask for a new one.</p>
        <Link href="/forgot-password" className={`${btnPrimary} mt-6 h-12 w-full text-base`}>Send a new link</Link>
        <BackToSignIn />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      <Alert text={error} />
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-busy={busy}>
        <Field id="reset-password" label="New password" error={fieldError} hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
          <PasswordInput ref={passwordRef} id="reset-password" name="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required autoFocus
            value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? 'reset-password-error' : 'reset-password-hint'} />
        </Field>
        <button type="submit" disabled={busy} className={`${btnPrimary} h-12 w-full text-base`}>{busy ? 'Saving…' : 'Save and sign in'}</button>
      </form>
    </AuthCard>
  );
}

/** Opened from the confirmation email. */
export function ConfirmEmail() {
  const token = useHashToken();
  const [state, setState] = useState<{ status: 'working' | 'done' | 'failed'; email?: string; message?: string }>({ status: 'working' });

  useEffect(() => {
    if (token === undefined) return;
    if (!token) { setState({ status: 'failed', message: 'This link is not complete. Open it from the email again.' }); return; }
    api<{ email: string }>('/api/auth/email/confirm', { method: 'POST', body: JSON.stringify({ token }) })
      .then((result) => setState({ status: 'done', email: result.email }))
      .catch((caught) => setState({ status: 'failed', message: errorMessage(caught) }));
  }, [token]);

  if (state.status === 'working') return <AuthCard title="Confirming your email…"><p className="text-center text-[15px] text-muted">One moment.</p></AuthCard>;
  if (state.status === 'failed') {
    return (
      <AuthCard title="Link not valid">
        <p className="-mt-3 text-center text-[15px] leading-[1.6] text-ink-2">{state.message}</p>
        <Link href="/account" className={`${btnPrimary} mt-6 h-12 w-full text-base`}>Go to your account</Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Email confirmed">
      <div className="-mt-1 flex flex-col items-center text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-green-50 text-green-600"><LuCircleCheck size={22} aria-hidden="true" /></span>
        <p className="mt-4 text-[15px] leading-[1.6] text-ink-2"><strong className="font-semibold text-ink">{state.email}</strong> is confirmed.</p>
      </div>
      <Link href="/editor" className={`${btnPrimary} mt-6 h-12 w-full text-base`}>Open Videmak</Link>
    </AuthCard>
  );
}
