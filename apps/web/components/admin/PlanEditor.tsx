'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, StatusPill, inputClass } from '@/components/app/ui';
import { api } from '@/lib/session';
import { LuArrowDown, LuArrowUp, LuCheck, LuMinus, LuPlus, LuRefreshCw, LuTrash2, LuX } from 'react-icons/lu';
import { money, stripeState, type AdminPlan, type CountLimit, type LimitDef } from './planTypes';

type LimitDraft = { amount: string; per: 'day' | 'month'; on: boolean };
type FeatureDraft = { key: number; label: string; included: boolean };
type Draft = {
  id: string; name: string; tagline: string; sort_order: string; monthly: string; yearly: string; currency: string; trial_days: string;
  is_default: boolean; is_public: boolean; featured: boolean; checkout: 'self_serve' | 'contact'; contact_url: string;
  limits: Record<string, LimitDraft>; features: FeatureDraft[];
};

let featureKey = 0;
const dollars = (cents: number) => (cents ? String(cents / 100) : '');

function toDraft(plan: AdminPlan | null, defs: Record<string, LimitDef>, nextSort: number): Draft {
  const limits: Record<string, LimitDraft> = {};
  for (const [key, def] of Object.entries(defs)) {
    const value = plan?.limits[key];
    if (def.kind === 'count') {
      const count = (value && typeof value === 'object' ? value : { amount: null, per: 'month' }) as CountLimit;
      limits[key] = { amount: count.amount === null ? '' : String(count.amount), per: count.per, on: true };
    } else if (def.kind === 'total') {
      limits[key] = { amount: typeof value === 'number' ? String(value) : '', per: 'month', on: true };
    } else {
      limits[key] = { amount: '', per: 'month', on: value === undefined || value === null ? true : Boolean(value) };
    }
  }
  return {
    id: plan?.id ?? '', name: plan?.name ?? '', tagline: plan?.tagline ?? '', sort_order: String(plan?.sort_order ?? nextSort),
    monthly: dollars(plan?.monthly_cents ?? 0), yearly: dollars(plan?.yearly_cents ?? 0), currency: plan?.currency ?? 'usd',
    trial_days: String(plan?.trial_days ?? 0), is_default: plan?.is_default ?? false, is_public: plan?.is_public ?? true,
    featured: plan?.featured ?? false, checkout: plan?.checkout ?? 'self_serve', contact_url: plan?.contact_url ?? '',
    limits, features: (plan?.features ?? []).map((feature) => ({ key: (featureKey += 1), ...feature })),
  };
}

/** Dollars typed by the admin → whole cents; null when it is not a usable amount. */
function cents(value: string): number | null {
  if (!value.trim()) return 0;
  const amount = Number(value.replace(/[$,\s]/g, ''));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function wholeNumber(value: string): number | null {
  if (!value.trim()) return null;
  const amount = Number(value.replace(/[,\s]/g, ''));
  return Number.isInteger(amount) && amount >= 0 ? amount : NaN;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-line px-3.5 text-[14px]">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand' : 'bg-line'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

function Field({ label, htmlFor, children, className = '' }: { label: string; htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</label>
      {children}
    </div>
  );
}

/** Create or edit one plan: prices, limits and the features shown on pricing. */
export function PlanEditor({ plan, defs, nextSort, onClose, onSaved }: {
  plan: AdminPlan | null; defs: Record<string, LimitDef>; nextSort: number; onClose: () => void; onSaved: (message: string, problem?: boolean) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(plan, defs, nextSort));
  const [newFeature, setNewFeature] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const idEdited = useRef(false);
  const firstField = useRef<HTMLInputElement>(null);
  const isNew = !plan;

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const setLimit = (key: string, value: Partial<LimitDraft>) => setDraft((current) => ({ ...current, limits: { ...current.limits, [key]: { ...current.limits[key], ...value } } }));
  const setFeature = (index: number, value: Partial<FeatureDraft>) => setDraft((current) => ({ ...current, features: current.features.map((feature, at) => (at === index ? { ...feature, ...value } : feature)) }));
  const moveFeature = (index: number, by: number) => setDraft((current) => {
    const features = [...current.features];
    const target = index + by;
    if (target < 0 || target >= features.length) return current;
    [features[index], features[target]] = [features[target], features[index]];
    return { ...current, features };
  });
  const addFeature = () => {
    const label = newFeature.trim();
    if (!label) return;
    setDraft((current) => ({ ...current, features: [...current.features, { key: (featureKey += 1), label, included: true }] }));
    setNewFeature('');
  };

  const build = (): { body: Record<string, unknown> } | { problem: string } => {
    const id = draft.id.trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(id)) return { problem: 'Id: lowercase letters, digits and dashes, e.g. "plus".' };
    if (!draft.name.trim()) return { problem: 'Name the plan.' };
    const monthly = cents(draft.monthly);
    const yearly = cents(draft.yearly);
    if (monthly === null || yearly === null) return { problem: 'Prices must be amounts like 12 or 9.99.' };
    const trial = wholeNumber(draft.trial_days) ?? 0;
    const sort = wholeNumber(draft.sort_order) ?? 0;
    if (Number.isNaN(trial) || Number.isNaN(sort)) return { problem: 'Trial days and order must be whole numbers.' };
    if (draft.checkout === 'contact' && !draft.contact_url.trim()) return { problem: 'Add a contact link for "Talk to us".' };
    const limits: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(defs)) {
      const value = draft.limits[key];
      if (def.kind === 'feature') { limits[key] = value.on; continue; }
      const amount = wholeNumber(value.amount);
      if (Number.isNaN(amount)) return { problem: `${def.label}: a whole number, or blank for unlimited.` };
      limits[key] = def.kind === 'count' ? { amount, per: value.per } : amount;
    }
    const features = draft.features.map(({ label, included }) => ({ label: label.trim(), included })).filter((feature) => feature.label);
    return {
      body: {
        name: draft.name.trim(), tagline: draft.tagline.trim(), sort_order: sort, is_default: draft.is_default, is_public: draft.is_public,
        featured: draft.featured, checkout: draft.checkout, contact_url: draft.contact_url.trim() || null, monthly_cents: monthly,
        yearly_cents: yearly, currency: draft.currency.trim().toLowerCase() || 'usd', trial_days: trial, limits, features,
      },
    };
  };

  const save = async () => {
    const built = build();
    if ('problem' in built) { setError(built.problem); return; }
    setBusy('save'); setError(null);
    try {
      const id = draft.id.trim().toLowerCase();
      const result = await api<{ ok: boolean; stripe_error: string | null }>(`/api/admin/plans/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(built.body) });
      onSaved(result.stripe_error ? `Saved ${draft.name.trim()}, but Stripe refused the prices: ${result.stripe_error}` : `Saved ${draft.name.trim()}.`, Boolean(result.stripe_error));
    } catch (caught) { setError((caught as Error).message); } finally { setBusy(null); }
  };

  const syncStripe = async () => {
    if (!plan) return;
    setBusy('stripe'); setError(null);
    try {
      await api(`/api/admin/plans/${encodeURIComponent(plan.id)}/stripe`, { method: 'POST' });
      onSaved(`${plan.name} synced to Stripe.`);
    } catch (caught) { setError((caught as Error).message); } finally { setBusy(null); }
  };

  const remove = async () => {
    if (!plan) return;
    setBusy('delete'); setError(null);
    try {
      await api(`/api/admin/plans/${encodeURIComponent(plan.id)}`, { method: 'DELETE' });
      onSaved(`Deleted ${plan.name}.`);
    } catch (caught) { setError((caught as Error).message); setConfirmDelete(false); } finally { setBusy(null); }
  };

  const yearlyCents = cents(draft.yearly);
  const monthlyCents = cents(draft.monthly);
  const saving = monthlyCents && yearlyCents ? Math.round((1 - yearlyCents / (monthlyCents * 12)) * 100) : 0;
  const stripe = plan ? stripeState(plan) : null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-ink/40" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="plan-editor-title" className="flex h-full w-full max-w-[640px] flex-col bg-white shadow-[0_20px_60px_-20px_rgba(15,23,42,.45)]">
        <div className="flex items-center gap-3 border-b border-line-2 px-5 py-4">
          <h2 id="plan-editor-title" className="min-w-0 flex-1 truncate text-[17px] font-bold tracking-[-0.01em]">{isNew ? 'New plan' : plan.name}</h2>
          {stripe && <StatusPill tone={stripe.tone}>{stripe.label}</StatusPill>}
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-[10px] text-muted hover:bg-soft hover:text-ink"><LuX size={18} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <section className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="plan-name">
              <input id="plan-name" ref={firstField} value={draft.name} onChange={(event) => { const name = event.target.value; setDraft((current) => ({ ...current, name, id: isNew && !idEdited.current ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 31) : current.id })); }} className={inputClass} placeholder="Plus" />
            </Field>
            <Field label="Id" htmlFor="plan-id">
              <input id="plan-id" value={draft.id} disabled={!isNew} onChange={(event) => { idEdited.current = true; set('id', event.target.value); }} className={`${inputClass} font-mono text-[13.5px] disabled:bg-soft disabled:text-muted`} placeholder="plus" spellCheck={false} />
            </Field>
            <Field label="Tagline" htmlFor="plan-tagline" className="sm:col-span-2">
              <input id="plan-tagline" value={draft.tagline} onChange={(event) => set('tagline', event.target.value)} className={inputClass} placeholder="For students writing every week" />
            </Field>
          </section>

          <h3 className="mt-7 mb-3 text-[14px] font-bold">Price</h3>
          <section className="grid gap-4 sm:grid-cols-2">
            <Field label="Monthly" htmlFor="plan-monthly">
              <input id="plan-monthly" inputMode="decimal" value={draft.monthly} onChange={(event) => set('monthly', event.target.value)} className={inputClass} placeholder="0" />
            </Field>
            <Field label={saving > 0 ? `Yearly (whole year · saves ${saving}%)` : 'Yearly (whole year)'} htmlFor="plan-yearly">
              <input id="plan-yearly" inputMode="decimal" value={draft.yearly} onChange={(event) => set('yearly', event.target.value)} className={inputClass} placeholder="0" />
              {yearlyCents ? <p className="mt-1 text-[12.5px] text-muted">{money(Math.round(yearlyCents / 12), draft.currency || 'usd')} / month</p> : null}
            </Field>
            <Field label="Currency" htmlFor="plan-currency">
              <input id="plan-currency" maxLength={3} value={draft.currency} onChange={(event) => set('currency', event.target.value.toLowerCase())} className={`${inputClass} uppercase`} />
            </Field>
            <Field label="Free trial (days)" htmlFor="plan-trial">
              <input id="plan-trial" inputMode="numeric" value={draft.trial_days} onChange={(event) => set('trial_days', event.target.value)} className={inputClass} />
            </Field>
          </section>

          <h3 className="mt-7 mb-3 text-[14px] font-bold">Checkout</h3>
          <div role="radiogroup" aria-label="Checkout" className="grid grid-cols-2 gap-2">
            {([['self_serve', 'Self-serve'], ['contact', 'Talk to us']] as const).map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={draft.checkout === value} onClick={() => set('checkout', value)}
                className={`h-11 rounded-xl border text-[14px] font-semibold ${draft.checkout === value ? 'border-brand bg-brand-50 text-brand-600' : 'border-line text-ink-2 hover:bg-soft'}`}>
                {label}
              </button>
            ))}
          </div>
          {draft.checkout === 'contact' && (
            <Field label="Contact link" htmlFor="plan-contact" className="mt-3">
              <input id="plan-contact" value={draft.contact_url} onChange={(event) => set('contact_url', event.target.value)} className={inputClass} placeholder="mailto:hello@videmak.net" spellCheck={false} />
            </Field>
          )}

          <h3 className="mt-7 mb-3 text-[14px] font-bold">Shown as</h3>
          <section className="grid gap-2 sm:grid-cols-3">
            <Toggle label="On pricing" checked={draft.is_public} onChange={(value) => set('is_public', value)} />
            <Toggle label="Most popular" checked={draft.featured} onChange={(value) => set('featured', value)} />
            <Toggle label="Default" checked={draft.is_default} onChange={(value) => set('is_default', value)} />
          </section>
          <Field label="Order" htmlFor="plan-order" className="mt-3 max-w-[140px]">
            <input id="plan-order" inputMode="numeric" value={draft.sort_order} onChange={(event) => set('sort_order', event.target.value)} className={inputClass} />
          </Field>

          <h3 className="mt-7 mb-1 text-[14px] font-bold">Limits</h3>
          <p className="mb-3 text-[12.5px] text-muted">Blank = unlimited</p>
          <div className="flex flex-col divide-y divide-line-2 rounded-xl border border-line">
            {Object.entries(defs).map(([key, def]) => {
              const value = draft.limits[key];
              return (
                <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
                  <label htmlFor={`limit-${key}`} className="min-w-[150px] flex-1 text-[14px]">{def.label}</label>
                  {def.kind === 'feature' ? (
                    <button id={`limit-${key}`} type="button" role="switch" aria-checked={value.on} aria-label={def.label} onClick={() => setLimit(key, { on: !value.on })}
                      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${value.on ? 'bg-brand' : 'bg-line'}`}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${value.on ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input id={`limit-${key}`} inputMode="numeric" value={value.amount} onChange={(event) => setLimit(key, { amount: event.target.value })}
                        placeholder="Unlimited" className="h-9 w-[112px] rounded-[10px] border border-line px-3 text-[14px] tabular-nums placeholder:text-subtle focus:border-brand focus:outline-none" />
                      {def.kind === 'count' ? (
                        <select aria-label={`${def.label} per`} value={value.per} onChange={(event) => setLimit(key, { per: event.target.value as 'day' | 'month' })}
                          className="h-9 rounded-[10px] border border-line bg-white px-2 text-[14px] focus:border-brand focus:outline-none">
                          <option value="day">a day</option>
                          <option value="month">a month</option>
                        </select>
                      ) : <span className="w-[86px] text-[13px] text-muted">in total</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <h3 className="mt-7 mb-3 text-[14px] font-bold">Features on pricing</h3>
          <ul className="flex flex-col gap-2">
            {draft.features.map((feature, index) => (
              <li key={feature.key} className="flex items-center gap-1.5">
                <button type="button" onClick={() => setFeature(index, { included: !feature.included })} aria-label={feature.included ? 'Included (mark not included)' : 'Not included (mark included)'} title={feature.included ? 'Included' : 'Not included'}
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border ${feature.included ? 'border-green-200 bg-green-50 text-green-700' : 'border-line bg-soft text-subtle'}`}>
                  {feature.included ? <LuCheck size={16} /> : <LuMinus size={16} />}
                </button>
                <input aria-label={`Feature ${index + 1}`} value={feature.label} onChange={(event) => setFeature(index, { label: event.target.value })}
                  className={`h-9 min-w-0 flex-1 rounded-[10px] border border-line px-3 text-[14px] focus:border-brand focus:outline-none ${feature.included ? '' : 'text-muted'}`} />
                <button type="button" onClick={() => moveFeature(index, -1)} disabled={index === 0} aria-label="Move up" className="grid h-9 w-8 shrink-0 place-items-center rounded-[10px] text-muted hover:bg-soft disabled:opacity-30"><LuArrowUp size={15} /></button>
                <button type="button" onClick={() => moveFeature(index, 1)} disabled={index === draft.features.length - 1} aria-label="Move down" className="grid h-9 w-8 shrink-0 place-items-center rounded-[10px] text-muted hover:bg-soft disabled:opacity-30"><LuArrowDown size={15} /></button>
                <button type="button" onClick={() => setDraft((current) => ({ ...current, features: current.features.filter((_, at) => at !== index) }))} aria-label="Remove" className="grid h-9 w-8 shrink-0 place-items-center rounded-[10px] text-muted hover:bg-red-50 hover:text-red-600"><LuX size={15} /></button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center gap-2">
            <input aria-label="New feature" value={newFeature} onChange={(event) => setNewFeature(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addFeature(); } }}
              placeholder="Add a feature" className="h-9 min-w-0 flex-1 rounded-[10px] border border-dashed border-line px-3 text-[14px] placeholder:text-subtle focus:border-brand focus:outline-none" />
            <Button size="sm" onClick={addFeature} disabled={!newFeature.trim()}><LuPlus size={15} />Add</Button>
          </div>
        </div>

        <div className="border-t border-line-2 px-5 py-3.5">
          {error && <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13.5px] text-red-700">{error}</p>}
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-[14px] font-medium">Delete {plan?.name}?</span>
              <Button size="sm" onClick={() => setConfirmDelete(false)}>Keep</Button>
              <Button size="sm" variant="danger" onClick={() => void remove()} disabled={busy === 'delete'}>{busy === 'delete' ? 'Deleting…' : 'Delete'}</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={() => void save()} disabled={Boolean(busy)}>{busy === 'save' ? 'Saving…' : isNew ? 'Create plan' : 'Save'}</Button>
              <Button onClick={onClose}>Cancel</Button>
              {plan && !plan.is_default && plan.checkout === 'self_serve' && (
                <Button variant="ghost" onClick={() => void syncStripe()} disabled={Boolean(busy)}><LuRefreshCw size={15} className={busy === 'stripe' ? 'animate-spin' : ''} />Sync to Stripe</Button>
              )}
              {plan && !plan.is_default && (
                <Button variant="danger" className="ml-auto" onClick={() => setConfirmDelete(true)} disabled={Boolean(busy)} aria-label="Delete plan"><LuTrash2 size={15} />Delete</Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
