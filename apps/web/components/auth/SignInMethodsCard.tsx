'use client';

import { useCallback, useEffect, useState } from 'react';
import { LuKeyRound, LuLock, LuTrash2 } from 'react-icons/lu';
import { Button, Card, CardHeader, StatusPill } from '@/components/app/ui';
import { api } from '@/lib/session';
import { addPasskey, getMyMethods, passkeyCancelled, passkeysSupported, PROVIDER_NAMES, PROVIDERS, startProvider, type MyMethods, type Provider } from '@/lib/signin';
import { ProviderLogo } from './ProviderLogo';

const day = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Account › Sign-in methods: password, connected Google/Microsoft/Apple, passkeys. */
export function SignInMethodsCard() {
  const [mine, setMine] = useState<MyMethods | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [canPasskey, setCanPasskey] = useState(false);

  const load = useCallback(() => getMyMethods().then(setMine).catch((caught) => setNotice({ tone: 'error', text: (caught as Error).message })), []);

  useEffect(() => {
    setCanPasskey(passkeysSupported());
    // Back from connecting a provider.
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const connected = hash.get('connected') as Provider | null;
    const failed = hash.get('signin-error');
    if (connected || failed) {
      setNotice(failed ? { tone: 'error', text: failed } : { tone: 'ok', text: `${PROVIDER_NAMES[connected!] ?? 'Account'} connected.` });
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      document.getElementById('sign-in-methods')?.scrollIntoView({ block: 'center' });
    }
    void load();
  }, [load]);

  const run = async (key: string, work: () => Promise<unknown>, done: string) => {
    setBusy(key); setNotice(null);
    try {
      await work();
      setNotice({ tone: 'ok', text: done });
      await load();
    } catch (caught) {
      if (!passkeyCancelled(caught)) setNotice({ tone: 'error', text: (caught as Error).message || 'Something went wrong.' });
    }
    setBusy(null);
  };

  if (!mine) return null;
  const providers = PROVIDERS.filter((provider) => mine.available[provider] || mine.providers[provider].connected);
  const showPasskeys = mine.available.passkeys || mine.passkeys.length > 0;
  const row = 'flex min-h-[60px] flex-wrap items-center gap-3 border-t border-line-2 px-5 py-3 first:border-t-0';

  return (
    <Card>
      <div id="sign-in-methods" />
      <CardHeader title="Sign-in methods" />
      {notice && (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`mx-5 mt-4 rounded-xl px-4 py-2.5 text-[14px] ${notice.tone === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>{notice.text}</p>
      )}
      <div className="py-1">
        <div className={row}>
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-soft"><LuLock className="h-[18px] w-[18px] text-ink-2" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1 text-[14.5px] font-medium">Email and password</span>
          <StatusPill tone={mine.password ? 'positive' : 'neutral'}>{mine.password ? 'On' : 'Not set'}</StatusPill>
        </div>
        {providers.map((provider) => {
          const state = mine.providers[provider];
          return (
            <div key={provider} className={row}>
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-soft"><ProviderLogo provider={provider} size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium">{PROVIDER_NAMES[provider]}</span>
                {state.connected && state.email && <span className="block truncate text-[13px] text-muted">{state.email}</span>}
              </span>
              {state.connected ? (
                <Button variant="ghost" size="sm" disabled={busy !== null}
                  onClick={() => void run(`off-${provider}`, () => api(`/api/auth/identities/${provider}`, { method: 'DELETE' }), `${PROVIDER_NAMES[provider]} disconnected.`)}>
                  {busy === `off-${provider}` ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              ) : (
                <Button size="sm" disabled={busy !== null} onClick={() => { setBusy(provider); startProvider(provider, { mode: 'connect' }).catch((caught) => { setBusy(null); setNotice({ tone: 'error', text: (caught as Error).message }); }); }}>
                  {busy === provider ? 'Opening…' : 'Connect'}
                </Button>
              )}
            </div>
          );
        })}
        {showPasskeys && (
          <div className={row}>
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-soft"><LuKeyRound className="h-[18px] w-[18px] text-ink-2" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] font-medium">Passkeys</span>
              <span className="block text-[13px] text-muted">{mine.passkeys.length ? `${mine.passkeys.length} saved` : 'Sign in with your fingerprint, face or screen lock'}</span>
            </span>
            {mine.available.passkeys && canPasskey && (
              <Button size="sm" disabled={busy !== null} onClick={() => void run('add-passkey', addPasskey, 'Passkey added.')}>
                {busy === 'add-passkey' ? 'Waiting…' : 'Add a passkey'}
              </Button>
            )}
          </div>
        )}
        {mine.passkeys.map((passkey) => (
          <div key={passkey.id} className="flex items-center gap-3 border-t border-line-2 py-2.5 pl-[68px] pr-5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px]">{passkey.name}</span>
              <span className="block text-[12.5px] text-muted">Added {day(passkey.created_at)}{passkey.last_used_at ? ` · last used ${day(passkey.last_used_at)}` : ''}</span>
            </span>
            <Button variant="ghost" size="sm" aria-label={`Remove ${passkey.name}`} disabled={busy !== null}
              onClick={() => void run(`rm-${passkey.id}`, () => api(`/api/auth/passkeys/${passkey.id}`, { method: 'DELETE' }), 'Passkey removed.')}>
              <LuTrash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
