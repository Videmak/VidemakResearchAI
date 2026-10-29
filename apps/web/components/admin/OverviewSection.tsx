'use client';

import type { IconType } from 'react-icons';
import { LuActivity, LuChevronRight, LuFileText, LuLayoutDashboard, LuLibrary, LuUsers } from 'react-icons/lu';
import { Card, CardHeader, EmptyState, StatusPill } from '@/components/app/ui';
import { SectionHeader, needsKeys, pairUp } from './SettingsSection';
import { isOn, when, words, type Overview, type Setting } from './adminTypes';
import { money, type PlansResponse, type Subscriber } from './planTypes';

const LIVE = ['active', 'past_due'];
const SERVICES: Record<string, string> = {
  conversions: 'Word, LaTeX and PDF files', llm_input_tokens: 'AI input tokens', llm_cached_tokens: 'AI cached input tokens', llm_output_tokens: 'AI output tokens',
  papers_requests: 'Paper requests', files_requests: 'Full text requests', research_calls: 'Research tool calls', reference_checks: 'Reference checks', review_words: 'Words reviewed',
};

export type GroupStatus = { tone: 'positive' | 'warning' | 'neutral'; label: string };

/** How ready a settings group is, in two words. */
/** Settings each provider needs before it works (storage, email, newsletter). */
const REQUIRED: Record<string, Record<string, string[]>> = {
  storage: { local: [], wasabi: ['s3Bucket', 's3AccessKeyId', 's3SecretAccessKey'], s3: ['s3Bucket', 's3AccessKeyId', 's3SecretAccessKey', 's3Endpoint'] },
  email: { smtp: ['smtpHost', 'mailFrom'], resend: ['resendApiKey', 'mailFrom'] },
  newsletter: { mailcheap: ['mailcheapApiKey'] },
};

export function groupStatus(group: string, fields: Setting[]): GroupStatus {
  if (!fields.length) return { tone: 'neutral', label: '—' };
  const { blocks } = pairUp(fields);
  if (blocks.length) {
    const on = blocks.filter((block) => isOn(block.toggle));
    const missing = on.filter((block) => needsKeys(block.fields)).length;
    if (missing) return { tone: 'warning', label: `${missing} need${missing === 1 ? 's' : ''} keys` };
    return { tone: on.length ? 'positive' : 'warning', label: `${on.length} of ${blocks.length} on` };
  }
  const needs = REQUIRED[group];
  if (needs) {
    const choice = fields.find((field) => field.options && field.key.endsWith('Provider'));
    const value = choice?.value ?? '';
    if (!value) return { tone: 'neutral', label: 'Off' };
    const required = needs[value] ?? [];
    const missing = required.filter((key) => !fields.find((field) => field.key === key)?.set).length;
    if (missing) return { tone: 'warning', label: 'Needs settings' };
    return { tone: 'positive', label: choice?.labels?.[value] ?? value };
  }
  if (group === 'papers') {
    const provider = fields.find((field) => field.key === 'papersProvider')?.value;
    const scholarKey = fields.find((field) => field.key === 'scholarApiKey')?.set;
    return provider === 'scholar' && !scholarKey ? { tone: 'warning', label: 'Needs a key' } : { tone: 'positive', label: 'Ready' };
  }
  const secrets = fields.filter((field) => field.secret);
  if (!secrets.length) return { tone: 'positive', label: 'Ready' };
  const set = secrets.filter((field) => field.set).length;
  if (set === secrets.length) return { tone: 'positive', label: 'Ready' };
  if (group === 'cloud') return { tone: 'neutral', label: set ? `${set} of ${secrets.length} keys` : 'Not used' };
  return { tone: 'warning', label: set ? `${set} of ${secrets.length} keys` : 'Needs a key' };
}

function Stat({ icon: Icon, label, value, note }: { icon: IconType; label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center gap-2 text-[13px] text-muted"><Icon size={15} />{label}</div>
      <p className="mt-2 text-[26px] font-bold tabular-nums tracking-[-0.02em]">{value}</p>
      {note && <p className="text-[12.5px] text-muted">{note}</p>}
    </div>
  );
}

type Props = {
  overview: Overview | null;
  plans: PlansResponse | null;
  subscribers: Subscriber[] | null;
  services: { id: string; title: string; icon: IconType; status: GroupStatus }[];
  open: (section: string) => void;
};

/** Admin › Overview: counts, revenue, plan mix, service health and recent changes. */
export function OverviewSection({ overview, plans, subscribers, services, open }: Props) {
  const planList = plans?.plans ?? [];
  const paying = (subscribers ?? []).filter((person) => person.plan_source === 'stripe' && LIVE.includes(person.plan_status));
  const mrr = paying.reduce((sum, person) => {
    const plan = planList.find((item) => item.id === person.plan);
    if (!plan) return sum;
    return sum + (person.plan_interval === 'year' ? Math.round(plan.yearly_cents / 12) : plan.monthly_cents);
  }, 0);
  const given = (subscribers ?? []).filter((person) => person.plan_source === 'admin').length;
  const counted = planList.filter((plan) => !plan.is_default);
  const most = Math.max(1, ...counted.map((plan) => plan.subscribers));
  const count = (value: number | undefined) => (value === undefined ? '—' : value.toLocaleString('en-US'));

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader icon={LuLayoutDashboard} title="Overview" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={LuUsers} label="Users" value={count(overview?.counts.users)} />
        <Stat icon={LuActivity} label="Paying" value={subscribers ? count(paying.length) : '—'} note={subscribers ? `${money(mrr)} MRR${given ? ` · ${given} given` : ''}` : undefined} />
        <Stat icon={LuFileText} label="Documents" value={count(overview?.counts.documents)} />
        <Stat icon={LuLibrary} label="Library items" value={count(overview?.counts.library)} note={overview ? `${count(overview.counts.keys)} API keys` : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Plans" actions={<button type="button" onClick={() => open('plans')} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline">Manage<LuChevronRight size={14} /></button>} />
          {!plans ? <p className="px-5 py-6 text-[13.5px] text-muted">Loading…</p> : (
            <ul className="flex flex-col gap-3.5 px-5 py-4">
              {counted.map((plan) => (
                <li key={plan.id}>
                  <div className="flex items-baseline justify-between text-[14px]"><span className="font-medium">{plan.name}</span><span className="tabular-nums text-muted">{plan.subscribers}</span></div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line-2">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${(plan.subscribers / most) * 100}%`, minWidth: plan.subscribers ? 8 : 0 }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Services" />
          <ul className="divide-y divide-line-2">
            {services.map(({ id, title, icon: Icon, status }) => (
              <li key={id}>
                <button type="button" onClick={() => open(id)} className="flex h-12 w-full items-center gap-3 px-5 text-left hover:bg-soft">
                  <Icon size={17} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{title}</span>
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  <LuChevronRight size={15} className="shrink-0 text-subtle" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Usage this month" />
          {!overview ? <p className="px-5 py-6 text-[13.5px] text-muted">Loading…</p> : overview.usage.length === 0 ? <EmptyState title="Nothing yet" /> : (
            <ul className="divide-y divide-line-2">
              {overview.usage.map((line) => (
                <li key={line.service} className="flex h-11 items-center justify-between px-5 text-[14px]">
                  <span className="truncate">{SERVICES[line.service] ?? words(line.service).replace(/^Llm\b/, 'AI')}</span>
                  <span className="tabular-nums text-muted">{Math.round(line.quantity).toLocaleString('en-US')}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent changes" actions={<button type="button" onClick={() => open('activity')} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline">All<LuChevronRight size={14} /></button>} />
          {!overview ? <p className="px-5 py-6 text-[13.5px] text-muted">Loading…</p> : overview.audit.length === 0 ? <EmptyState title="No changes yet" /> : (
            <ul className="divide-y divide-line-2">
              {overview.audit.slice(0, 6).map((entry, index) => (
                <li key={index} className="flex min-h-11 items-center gap-3 px-5 py-2 text-[13.5px]">
                  <span className="min-w-0 flex-1 truncate"><span className="font-medium">{words(entry.action)}</span> <span className="font-mono text-[12.5px] text-muted">{entry.target}</span></span>
                  <span className="shrink-0 text-[12.5px] text-subtle">{when(entry.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}
