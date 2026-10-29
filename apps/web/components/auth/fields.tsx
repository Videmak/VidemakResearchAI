'use client';

import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { focusRing } from '@/components/marketing/styles';

/** 16px on phones (no iOS zoom), 15px from 768px up. */
export const inputClass =
  'h-12 w-full rounded-xl border border-line bg-white px-3.5 text-base text-ink placeholder:text-slate-400 outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-4 focus:ring-brand-100 aria-invalid:border-red-400 aria-invalid:focus:ring-red-100 disabled:bg-soft md:text-[15px]';

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 text-[13.5px] font-medium text-red-600">
      {message}
    </p>
  );
}

export function Field({
  id,
  label,
  error,
  hint,
  aside,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <FieldError id={`${id}-error`} message={error} />
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1.5 text-[13px] text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

/** Password input with a show/hide toggle. */
export function PasswordInput(props: Omit<ComponentProps<'input'>, 'type' | 'className'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? 'text' : 'password'} className={`${inputClass} pr-12`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-controls={props.id}
        className={`absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors hover:bg-soft hover:text-ink ${focusRing}`}
      >
        <EyeIcon off={visible} />
        <span className="sr-only">Show password</span>
      </button>
    </div>
  );
}

/** Query-string values, read after mount so the form itself can be prerendered as static HTML. */
export function useQueryParams(): URLSearchParams | null {
  const [params, setParams] = useState<URLSearchParams | null>(null);
  useEffect(() => setParams(new URLSearchParams(window.location.search)), []);
  return params;
}

/** Only same-site paths are allowed as the post-sign-in destination (no open redirects). */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/editor';
  return raw;
}

export function currentNext(): string {
  return safeNext(new URLSearchParams(window.location.search).get('next'));
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;

/** The server's message when there is one, a plain-language fallback otherwise. */
export function errorMessage(error: unknown): string {
  if (error instanceof TypeError) return 'We could not reach Videmak. Check your connection and try again.';
  const message = error instanceof Error ? error.message : '';
  if (!message || message.includes('[object Object]')) return 'Something went wrong. Please try again.';
  return message;
}
