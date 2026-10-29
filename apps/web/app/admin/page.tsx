'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { IconType } from 'react-icons';
import {
  LuBookOpen, LuCheck, LuCircleAlert, LuCircleCheck, LuCloud, LuCopy, LuCreditCard, LuHardDrive, LuHistory, LuKeyRound, LuLayers,
  LuLayoutDashboard, LuMail, LuNewspaper, LuPlugZap, LuSend, LuSettings, LuSparkles, LuUsers, LuX,
} from 'react-icons/lu';
import { AppFrame } from '@/components/app/AppFrame';
import { Button, Card } from '@/components/app/ui';
import { ActivitySection } from '@/components/admin/ActivitySection';
import { PlansSection, SubscribersSection } from '@/components/admin/AdminPlans';
import { OverviewSection, groupStatus } from '@/components/admin/OverviewSection';
import { SectionHeader, SettingsCard } from '@/components/admin/SettingsSection';
import { CloudCreditsPanel, NewsletterPanel, StorageCopyPanel } from '@/components/admin/IntegrationPanels';
import type { Notice, Overview, Setting, TestResult, Webhook } from '@/components/admin/adminTypes';
import type { PlansResponse, Subscriber } from '@/components/admin/planTypes';
import { api, useSession } from '@/lib/session';

/** Settings groups from the server, in the order and with the names the console shows. */
const GROUPS: Record<string, { title: string; nav: string; subtitle: string; icon: IconType; test?: string; testLabel?: string }> = {
  signin: { title: 'Sign-in methods', nav: 'Sign-in', subtitle: 'How people sign in and sign up.', icon: LuKeyRound },
  storage: { title: 'Storage', nav: 'Storage', subtitle: 'Uploads, images and Word files.', icon: LuHardDrive, test: 'storage' },
  email: { title: 'Email', nav: 'Email', subtitle: 'Password resets and email confirmation.', icon: LuMail, test: 'email', testLabel: 'Send test email' },
  newsletter: { title: 'Newsletter', nav: 'Newsletter', subtitle: 'People with a confirmed email, kept in step with MailCheap.', icon: LuNewspaper, test: 'newsletter' },
  ai: { title: 'AI', nav: 'AI', subtitle: 'DeepSeek by default. Changes apply at once.', icon: LuSparkles, test: 'ai' },
  papers: { title: 'Papers', nav: 'Papers', subtitle: 'Scholar works without a key; a free key adds full text and research tools.', icon: LuBookOpen, test: 'papers' },
  billing: { title: 'Billing', nav: 'Billing', subtitle: 'Stripe, test mode for now.', icon: LuCreditCard, test: 'stripe' },
  cloud: { title: 'Cloud', nav: 'Cloud', subtitle: 'A Videmak key for this install, and the gateway this server runs.', icon: LuCloud },
};
const MANAGE: { id: string; nav: string; icon: IconType }[] = [
  { id: 'overview', nav: 'Overview', icon: LuLayoutDashboard },
  { id: 'plans', nav: 'Plans', icon: LuLayers },
  { id: 'subscribers', nav: 'Subscribers', icon: LuUsers },
  { id: 'activity', nav: 'Activity', icon: LuHistory },
];
const TONE_DOT = { positive: 'bg-green-500', warning: 'bg-amber-400', neutral: 'bg-slate-300' } as const;
const titleCase = (value: string) => value.replace(/[_-]/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());

export default function AdminPage() {
  const router = useRouter();
  const { user, loading } = useSession();
  const [section, setSection] = useState('overview');
  const [settings, setSettings] = useState<Setting[]>([]);
  const [webhook, setWebhook] = useState<Webhook | null>(null);
  const [redirects, setRedirects] = useState<Record<string, string>>({});
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [plans, setPlans] = useState<PlansResponse | null>(null);
  const [subscribers, setSubscribers] = useState<Subscriber[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [copied, setCopied] = useState(false);

  // The open section lives in ?section= so a reload or a shared link keeps it (?tab=plans still works).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get('section') || params.get('tab');
    if (wanted) setSection(wanted);
  }, []);
  const open = useCallback((id: string) => {
    setSection(id);
    const url = new URL(window.location.href);
    url.searchParams.delete('tab');
    if (id === 'overview') url.searchParams.delete('section'); else url.searchParams.set('section', id);
    window.history.replaceState(null, '', url);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    if (notice?.tone !== 'ok') return;
    const timer = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  const loadPlans = useCallback(async () => {
    const [planList, people] = await Promise.allSettled([
      api<PlansResponse>('/api/admin/plans'),
      api<{ subscribers: Subscriber[] }>('/api/admin/accounts/subscribers'),
    ]);
    if (planList.status === 'fulfilled') setPlans(planList.value);
    if (people.status === 'fulfilled') setSubscribers(people.value.subscribers);
    const failed = [planList, people].find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed) setNotice({ tone: 'error', text: (failed.reason as Error).message });
  }, []);

  const load = useCallback(async () => {
    const [config, info] = await Promise.allSettled([
      api<{ settings: Setting[]; stripe_webhook?: Webhook; signin_redirects?: Record<string, string> }>('/api/admin/settings'),
      api<Overview>('/api/admin/overview'),
      loadPlans(),
    ]);
    if (config.status === 'fulfilled') { setSettings(config.value.settings); setWebhook(config.value.stripe_webhook ?? null); setRedirects(config.value.signin_redirects ?? {}); }
    if (info.status === 'fulfilled') setOverview(info.value);
    const failed = [config, info].find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed) setNotice({ tone: 'error', text: (failed.reason as Error).message });
  }, [loadPlans]);

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/login?next=/admin'); return; }
    if (user.is_admin) void load();
  }, [load, loading, router, user]);

  const saveSettings = useCallback(async (values: Record<string, string | null>, key: string) => {
    setBusy(key); setNotice(null);
    try {
      const result = await api<{ settings: Setting[] }>('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ values }) });
      setSettings(result.settings);
      setNotice({ tone: 'ok', text: 'Saved. In use now.' });
      void api<Overview>('/api/admin/overview').then(setOverview).catch(() => {});
      return true;
    } catch (caught) {
      setNotice({ tone: 'error', text: (caught as Error).message });
      return false;
    } finally { setBusy(null); }
  }, []);

  const runTest = async (kind: string) => {
    setBusy(`test-${kind}`);
    setTests((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== kind)));
    try { const result = await api<TestResult>(`/api/admin/test/${kind}`, { method: 'POST' }); setTests((current) => ({ ...current, [kind]: result })); }
    catch (caught) { setTests((current) => ({ ...current, [kind]: { ok: false, error: (caught as Error).message } })); }
    finally { setBusy(null); }
  };

  const stripeSetup = async () => {
    setBusy('stripe-setup'); setNotice(null);
    try {
      const result = await api<{ webhook: string; plans: number }>('/api/admin/stripe/setup', { method: 'POST' });
      setNotice({ tone: 'ok', text: `Stripe is set up: webhook ${result.webhook}, ${result.plans} plans priced.` });
    } catch (caught) { setNotice({ tone: 'error', text: (caught as Error).message }); } finally { setBusy(null); }
  };

  // Settings groups in a fixed order, then any group the server adds later.
  const groups = useMemo(() => {
    const ids = [...new Set(settings.map((setting) => setting.group))];
    const known = Object.keys(GROUPS).filter((id) => ids.includes(id));
    return [...known, ...ids.filter((id) => !GROUPS[id])].map((id) => {
      const fields = settings.filter((setting) => setting.group === id);
      const meta = GROUPS[id] ?? { title: titleCase(id), nav: titleCase(id), subtitle: '', icon: LuSettings };
      return { id, ...meta, fields, status: groupStatus(id, fields) };
    });
  }, [settings]);

  if (!loading && user && !user.is_admin) {
    return <AppFrame title="Admin"><Card className="p-6 text-[14px] text-muted">This page is for Videmak admins.</Card></AppFrame>;
  }

  const group = groups.find((item) => item.id === section);
  const navButton = (id: string, label: string, Icon: IconType, dot?: string) => {
    const active = section === id;
    return (
      <button key={id} type="button" onClick={() => open(id)} aria-current={active ? 'page' : undefined}
        className={`flex h-9 shrink-0 items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[14px] font-medium transition-colors lg:w-full ${
          active ? 'bg-brand-50 text-brand' : 'text-ink-2 hover:bg-soft'} max-lg:border max-lg:bg-white max-lg:px-3 ${active ? 'max-lg:border-brand-100 max-lg:bg-brand-50' : 'max-lg:border-line'}`}>
        <Icon size={16} className="shrink-0" />
        <span className="flex-1 whitespace-nowrap">{label}</span>
        {dot && <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />}
      </button>
    );
  };

  let content: React.ReactNode;
  if (section === 'plans') content = <PlansSection data={plans} reload={loadPlans} notify={setNotice} />;
  else if (section === 'subscribers') content = <SubscribersSection data={plans} subscribers={subscribers} reload={loadPlans} notify={setNotice} />;
  else if (section === 'activity') content = <ActivitySection overview={overview} />;
  else if (group) {
    content = (
      <section>
        <SectionHeader icon={group.icon} title={group.title} subtitle={group.subtitle} actions={group.test ? (
          <Button size="sm" onClick={() => void runTest(group.test!)} disabled={busy === `test-${group.test}`}>
            {group.testLabel ? <LuSend size={15} /> : <LuPlugZap size={15} />}
            {busy === `test-${group.test}` ? (group.testLabel ? 'Sending…' : 'Testing…') : group.testLabel ?? 'Test connection'}
          </Button>
        ) : undefined} />
        <SettingsCard
          key={group.id}
          fields={group.fields}
          busy={busy}
          onSave={saveSettings}
          testResult={group.test ? tests[group.test] : undefined}
          extra={group.id === 'signin' && Object.keys(redirects).length ? (
            <div className="border-t border-line-2 px-5 py-4">
              <p className="text-[14px] font-medium">Callback URLs</p>
              <p className="mt-0.5 text-[12.5px] text-muted">Add each one as the redirect URI in that provider's console.</p>
              <div className="mt-2.5 flex flex-col gap-2">
                {Object.entries(redirects).map(([provider, url]) => (
                  <div key={provider} className="flex items-center gap-2">
                    <span className="w-[76px] shrink-0 text-[13px] capitalize text-ink-2">{provider}</span>
                    <code className="min-w-0 flex-1 truncate rounded-[10px] border border-line bg-soft px-3 py-2 font-mono text-[13px]">{url}</code>
                    <Button size="sm" aria-label={`Copy ${provider} callback URL`} onClick={() => { void navigator.clipboard?.writeText(url).then(() => { setCopiedUrl(provider); setTimeout(() => setCopiedUrl(null), 1500); }); }}>
                      {copiedUrl === provider ? <LuCheck size={15} /> : <LuCopy size={15} />}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : group.id === 'billing' && webhook ? (
            <div className="border-t border-line-2 px-5 py-4">
              <p className="text-[14px] font-medium">Webhook endpoint</p>
              <p className="mt-0.5 text-[12.5px] text-muted">Stripe → Developers → Webhooks → Add endpoint, then paste its signing secret above.</p>
              <div className="mt-2.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-[10px] border border-line bg-soft px-3 py-2 font-mono text-[13px]">{webhook.url}</code>
                <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(webhook.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
                  {copied ? <LuCheck size={15} /> : <LuCopy size={15} />}{copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {webhook.events.map((name) => <span key={name} className="rounded-md bg-line-2 px-2 py-1 font-mono text-[12px] text-ink-2">{name}</span>)}
              </div>
            </div>
          ) : group.id === 'storage' ? (
            <StorageCopyPanel provider={group.fields.find((field) => field.key === 'storageProvider')?.value ?? 'local'} notify={setNotice} />
          ) : group.id === 'newsletter' ? (
            <NewsletterPanel provider={group.fields.find((field) => field.key === 'newsletterProvider')?.value ?? ''} notify={setNotice} />
          ) : group.id === 'cloud' ? (
            <CloudCreditsPanel notify={setNotice} />
          ) : undefined}
          footer={group.id === 'billing' ? (
            <Button size="sm" className="ml-auto" onClick={() => void stripeSetup()} disabled={busy === 'stripe-setup'}>{busy === 'stripe-setup' ? 'Setting up…' : 'Set up Stripe'}</Button>
          ) : undefined}
        />
      </section>
    );
  } else {
    content = <OverviewSection overview={overview} plans={plans} subscribers={subscribers} services={groups.map(({ id, title, icon, status }) => ({ id, title, icon, status }))} open={open} />;
  }

  return (
    <AppFrame title="Admin" wide>
      <div className="lg:grid lg:grid-cols-[196px_minmax(0,1fr)] lg:gap-8">
        <nav aria-label="Admin sections" className="-mx-[18px] mb-5 flex gap-2 overflow-x-auto px-[18px] pb-1 lg:sticky lg:top-6 lg:mx-0 lg:mb-0 lg:flex-col lg:gap-0.5 lg:self-start lg:overflow-visible lg:px-0">
          <p className="hidden px-2.5 pb-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-subtle lg:block">Manage</p>
          {MANAGE.map((item) => navButton(item.id, item.nav, item.icon))}
          <p className="hidden px-2.5 pb-1 pt-4 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-subtle lg:block">Settings</p>
          {groups.map((item) => navButton(item.id, item.nav, item.icon, TONE_DOT[item.status.tone]))}
        </nav>
        <div className="min-w-0">{content}</div>
      </div>

      {notice && (
        <div role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`fixed bottom-24 left-1/2 z-[70] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2.5 rounded-xl px-4 py-3 text-[14px] shadow-[0_18px_40px_-16px_rgba(15,23,42,.5)] md:bottom-6 ${
            notice.tone === 'ok' ? 'bg-ink text-white' : 'border border-red-200 bg-red-50 text-red-800'}`}>
          {notice.tone === 'ok' ? <LuCircleCheck size={17} className="shrink-0 text-green-400" /> : <LuCircleAlert size={17} className="shrink-0" />}
          <span className="min-w-0">{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="ml-1 shrink-0 opacity-70 hover:opacity-100"><LuX size={15} /></button>
        </div>
      )}
    </AppFrame>
  );
}
