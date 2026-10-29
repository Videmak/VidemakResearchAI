'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * In-app replacements for window.prompt / window.confirm in the AI Editor: the browser's
 * own boxes look foreign, block the page and cannot be styled or offer choices.
 *
 *   const name = await editorPrompt({ title: 'Name this version', placeholder: 'Draft 2' });
 *   if (await editorConfirm({ title: 'Move to trash?', danger: true })) ...
 */

type PromptOptions = {
  title: string;
  message?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  okLabel?: string;
  /** A list to pick from instead of free text. */
  options?: { value: string; label: string }[];
  /** Allow an empty answer (e.g. an optional name). */
  allowEmpty?: boolean;
};

type ConfirmOptions = { title: string; message?: string; okLabel?: string; danger?: boolean };

type Request =
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void };

let root: Root | null = null;
let push: ((request: Request) => void) | null = null;
const queue: Request[] = [];

function Host() {
  const [request, setRequest] = useState<Request | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const pending = useRef<Request[]>([]);

  useEffect(() => {
    push = (next) => {
      pending.current.push(next);
      setRequest((current) => current ?? pending.current.shift() ?? null);
    };
    queue.splice(0).forEach((item) => push?.(item));
    return () => {
      push = null;
    };
  }, []);

  useEffect(() => {
    if (!request) return;
    setValue(request.kind === 'prompt' ? request.options.defaultValue ?? request.options.options?.[0]?.value ?? '' : '');
    window.setTimeout(() => {
      inputRef.current?.focus();
      if (inputRef.current instanceof HTMLInputElement) inputRef.current.select();
    }, 0);
  }, [request]);

  if (!request) return null;

  const finish = (accepted: boolean) => {
    if (request.kind === 'prompt') {
      const answer = value.trim();
      request.resolve(accepted && (answer || request.options.allowEmpty) ? answer : null);
    } else {
      request.resolve(accepted);
    }
    setRequest(pending.current.shift() ?? null);
  };

  const options = request.options;
  const danger = request.kind === 'confirm' && request.options.danger;
  return (
    <div
      className="fixed inset-0 z-[16500] flex items-end justify-center bg-[rgba(15,23,42,0.35)] p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) finish(false);
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={options.title}
        className="w-full max-w-[440px] rounded-t-[24px] border border-[#e5e7eb] bg-white p-5 shadow-[0_22px_50px_-18px_rgba(15,23,42,0.35)] sm:rounded-[16px]"
        onSubmit={(event) => {
          event.preventDefault();
          finish(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
          }
        }}
      >
        <h2 className="text-[18px] font-bold tracking-[-0.01em] text-[#0f172a]">{options.title}</h2>
        {options.message ? <p className="mt-1.5 text-[14px] leading-[1.55] text-[#334155]">{options.message}</p> : null}
        {request.kind === 'prompt' ? (
          <label className="mt-3 block text-[13px] font-medium text-[#334155]">
            {request.options.label}
            {request.options.options ? (
              <select
                ref={(node) => { inputRef.current = node; }}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className="mt-1.5 h-10 w-full rounded-[10px] border border-[#e5e7eb] bg-white px-3 text-[14px] text-[#0f172a] outline-none transition-shadow focus:border-[var(--theme-primary,#2563eb)] focus:shadow-[0_0_0_4px_#eff6ff]"
              >
                {request.options.options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : (
              <input
                ref={(node) => { inputRef.current = node; }}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={request.options.placeholder}
                className="mt-1.5 h-10 w-full rounded-[10px] border border-[#e5e7eb] px-3 text-[14px] text-[#0f172a] outline-none transition-shadow focus:border-[var(--theme-primary,#2563eb)] focus:shadow-[0_0_0_4px_#eff6ff]"
              />
            )}
          </label>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => finish(false)} className="h-10 rounded-[10px] border border-[#e5e7eb] bg-white px-4 text-[14px] font-semibold text-[#0f172a] hover:bg-[#f8fafc]">
            Cancel
          </button>
          <button
            type="submit"
            className={`h-10 rounded-[10px] px-[18px] text-[14px] font-semibold text-white ${danger ? 'bg-[#dc2626] shadow-[0_6px_16px_-6px_rgba(220,38,38,0.6)] hover:bg-[#b91c1c]' : 'bg-[var(--theme-primary,#2563eb)] shadow-[0_6px_16px_-6px_rgba(37,99,235,0.7)] hover:bg-[#1d4ed8]'}`}
          >
            {options.okLabel || 'OK'}
          </button>
        </div>
      </form>
    </div>
  );
}

function send(request: Request) {
  if (typeof document === 'undefined') {
    if (request.kind === 'prompt') request.resolve(null);
    else request.resolve(false);
    return;
  }
  if (!root) {
    const container = document.createElement('div');
    container.setAttribute('data-editor-dialogs', '');
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(<Host />);
  }
  if (push) push(request);
  else queue.push(request);
}

export function editorPrompt(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => send({ kind: 'prompt', options, resolve }));
}

export function editorConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => send({ kind: 'confirm', options, resolve }));
}
