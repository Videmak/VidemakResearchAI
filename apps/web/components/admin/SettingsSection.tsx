'use client';

import { useState } from 'react';
import type { IconType } from 'react-icons';
import { LuCircleAlert, LuCircleCheck, LuExternalLink, LuFingerprint, LuLogIn, LuMail, LuShieldCheck } from 'react-icons/lu';
import { Button, Card, inputClass } from '@/components/app/ui';
import { isOn, visibleFields, type Setting, type TestResult } from './adminTypes';

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-brand' : 'bg-[#cbd5e1]'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

/** Section heading used by every admin section: icon tile, title, one short line, actions. */
export function SectionHeader({ icon: Icon, title, subtitle, actions }: { icon: IconType; title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand"><Icon size={19} /></span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[19px] font-bold tracking-[-0.015em]">{title}</h2>
        {subtitle && <p className="text-[13.5px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const SOURCE: Record<Setting['source'], string> = { admin: 'Saved', server: 'Server', unset: 'Not set' };
const stem = (key: string) => key.toLowerCase().replace(/^(signin|auth|enable|login)/, '');

function providerIcon(setting: Setting): IconType {
  const name = stem(setting.key);
  if (name.includes('email') || name.includes('password') || name.includes('magic')) return LuMail;
  if (name.includes('passkey') || name.includes('webauthn')) return LuFingerprint;
  if (name.includes('turnstile') || name.includes('captcha')) return LuShieldCheck;
  return LuLogIn;
}

/** A switched-on method still missing one of its keys or ids. */
export const needsKeys = (fields: Setting[]) => fields.some((field) => !field.set);

/** A toggle and the settings that belong to it (signinGoogle → googleClientId, googleClientSecret). */
export function pairUp(fields: Setting[]) {
  const toggles = fields.filter((field) => field.kind === 'toggle');
  const owned = new Set<string>();
  const blocks: { toggle: Setting; fields: Setting[] }[] = [];
  for (const toggle of toggles) {
    const name = stem(toggle.key);
    const children = name.length >= 3 ? fields.filter((field) => field.kind !== 'toggle' && !owned.has(field.key) && stem(field.key).startsWith(name)) : [];
    children.forEach((field) => owned.add(field.key));
    blocks.push({ toggle, fields: children });
  }
  const rest = fields.filter((field) => field.kind !== 'toggle' && !owned.has(field.key));
  return { blocks, rest };
}

type Props = {
  fields: Setting[];
  busy: string | null;
  testResult?: TestResult;
  onSave: (values: Record<string, string | null>, key: string) => Promise<boolean>;
  extra?: React.ReactNode;
  footer?: React.ReactNode;
};

/** One settings group as a card: switches save at once, other fields save together. */
export function SettingsCard({ fields, busy, testResult, onSave, extra, footer }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState<Record<string, boolean>>({});
  const dirty = Object.keys(draft).length > 0;
  const groupKey = fields[0]?.group ?? 'group';

  const saveDraft = async () => {
    const values: Record<string, string | null> = {};
    for (const field of fields) {
      if (draft[field.key] === undefined) continue;
      const value = draft[field.key].trim();
      if (field.secret && !value) continue;
      values[field.key] = value === '' ? null : value;
    }
    if (!Object.keys(values).length) { setDraft({}); return; }
    if (await onSave(values, groupKey)) { setDraft({}); setReplacing({}); }
  };

  const control = (field: Setting) => {
    const id = `setting-${field.key}`;
    if (field.options) {
      return (
        <select id={id} value={draft[field.key] ?? field.value} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} className={`${inputClass} h-10 text-[14px]`}>
          {field.options.map((option) => <option key={option} value={option}>{field.labels?.[option] ?? (option || 'Automatic')}</option>)}
        </select>
      );
    }
    if (field.secret && field.set && !replacing[field.key]) {
      return (
        <div className="flex h-10 items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-[10px] border border-line bg-soft px-3 py-2 font-mono text-[13px] text-ink-2">{field.value}</code>
          <Button size="sm" onClick={() => setReplacing({ ...replacing, [field.key]: true })}>Replace</Button>
          {field.source === 'admin' && <Button size="sm" variant="ghost" disabled={busy === field.key} onClick={() => void onSave({ [field.key]: null }, field.key)}>Clear</Button>}
        </div>
      );
    }
    const input = (
      <input id={id} type={field.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} autoFocus={Boolean(replacing[field.key])}
        placeholder={field.secret ? 'Paste the key' : field.placeholder || 'Not set'}
        value={draft[field.key] ?? (field.secret ? '' : field.value)}
        onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
        className={`${inputClass} h-10 font-mono text-[13px]`} />
    );
    if (!replacing[field.key]) return input;
    return (
      <div className="flex items-center gap-2">
        {input}
        <Button size="sm" variant="ghost" onClick={() => {
          setReplacing({ ...replacing, [field.key]: false });
          setDraft(Object.fromEntries(Object.entries(draft).filter(([key]) => key !== field.key)));
        }}>Cancel</Button>
      </div>
    );
  };

  const row = (field: Setting, nested = false) => (
    <div key={field.key} className={`grid gap-1.5 py-3.5 md:grid-cols-[minmax(0,230px)_1fr] md:items-center md:gap-6 ${nested ? '' : 'px-5'}`}>
      <div className="min-w-0">
        <label htmlFor={`setting-${field.key}`} className="block text-[14px] font-medium leading-snug text-ink">{field.label}</label>
        <span className={`text-[12px] ${field.set ? 'text-green-700' : 'text-subtle'}`}>{SOURCE[field.source]}</span>
        {field.link && (
          <a href={field.link.href} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-[12px] font-semibold text-brand hover:underline">
            {field.link.label}<LuExternalLink size={11} />
          </a>
        )}
      </div>
      <div className="min-w-0">
        {control(field)}
        {field.help && !field.set && <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{field.help}</p>}
      </div>
    </div>
  );

  const { blocks, rest: all } = pairUp(fields);
  const shown = new Set(visibleFields(fields, draft).map((field) => field.key));
  const rest = all.filter((field) => shown.has(field.key));

  return (
    <Card className="overflow-hidden">
      {testResult && (
        <div className={`flex items-start gap-2 border-b px-5 py-3 text-[13.5px] ${testResult.ok ? 'border-green-100 bg-green-50 text-green-800' : 'border-red-100 bg-red-50 text-red-800'}`}>
          {testResult.ok ? <LuCircleCheck size={16} className="mt-px shrink-0" /> : <LuCircleAlert size={16} className="mt-px shrink-0" />}
          <span className="min-w-0 break-words">
            {testResult.ok
              ? `Works${[
                testResult.provider, testResult.mode, testResult.ms ? `${testResult.ms} ms` : '',
                testResult.full_text ? `full text ${testResult.full_text}` : '', testResult.research_tools ? `research tools ${testResult.research_tools}` : '',
                testResult.requests_left_today ? `${Number(testResult.requests_left_today).toLocaleString('en-US')} requests left today` : '',
              ].filter(Boolean).map((part) => ` · ${part}`).join('')}`
              : String(testResult.error || 'Not working').slice(0, 240)}
          </span>
        </div>
      )}

      {blocks.length > 0 && (
        <div className="divide-y divide-line-2">
          {blocks.map(({ toggle, fields: children }) => {
            const on = isOn(toggle);
            const Icon = providerIcon(toggle);
            return (
              <div key={toggle.key} className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${on ? 'bg-brand-50 text-brand' : 'bg-line-2 text-subtle'}`}><Icon size={17} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-semibold">{toggle.label}</p>
                    {on && needsKeys(children)
                      ? <p className="text-[12.5px] font-medium text-amber-700">On · needs keys</p>
                      : <p className="text-[12.5px] text-muted">{on ? 'On' : 'Off'}</p>}
                  </div>
                  <Switch label={toggle.label} checked={on} disabled={busy === toggle.key} onChange={(value) => void onSave({ [toggle.key]: value ? 'on' : 'off' }, toggle.key)} />
                </div>
                {children.length > 0 && (
                  <div className={`mt-2 rounded-xl border border-line-2 px-4 ${on ? '' : 'opacity-60'}`}>
                    <div className="divide-y divide-line-2">{children.map((field) => row(field, true))}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {rest.length > 0 && <div className={`divide-y divide-line-2 ${blocks.length ? 'border-t border-line-2' : ''}`}>{rest.map((field) => row(field))}</div>}

      {extra}

      {(dirty || footer) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line-2 px-5 py-3">
          {dirty && (
            <>
              <Button variant="primary" size="sm" onClick={() => void saveDraft()} disabled={busy === groupKey}>{busy === groupKey ? 'Saving…' : 'Save changes'}</Button>
              <Button variant="ghost" size="sm" onClick={() => { setDraft({}); setReplacing({}); }}>Discard</Button>
            </>
          )}
          {footer}
        </div>
      )}
    </Card>
  );
}
