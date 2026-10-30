'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LuExternalLink, LuLoader, LuSearch } from 'react-icons/lu';
import {
  connectZoteroKey, disconnectReferenceManager, getLibraryConnections, getReferenceCollections, startReferenceImport, startReferenceSignIn,
  type LibraryConnections, type ReferenceCollection, type ReferenceProvider,
} from '../../../utils/libraryApi';
import { FindPdfs, ImportProgress, UpgradeCard, plural, useImportJob } from './LibraryImportParts';

const NAMES: Record<ReferenceProvider, string> = { zotero: 'Zotero', mendeley: 'Mendeley' };
const ZOTERO_NEW_KEY = 'https://www.zotero.org/settings/keys/new?name=Videmak&library_access=1&notes_access=0&write_access=0';

type Props = {
  provider: ReferenceProvider;
  folderId: string | null;
  allowed: boolean;
  planName?: string;
  onUpgrade: (message?: string) => void;
  onChanged: () => void;
};

const primary = 'inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-[var(--theme-primary,#2563eb)] px-5 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50';
const secondary = 'inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-[#e2e8f0] bg-white px-4 text-[14px] font-semibold text-[#0f172a] hover:bg-[#f8fafc] disabled:opacity-50';

/** Zotero or Mendeley in the add dialog: connect once, then import the library or one collection. */
export function ReferenceManagerPane({ provider, folderId, allowed, planName, onUpgrade, onChanged }: Props) {
  const name = NAMES[provider];
  const [connections, setConnections] = useState<LibraryConnections | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    getLibraryConnections().then(setConnections).catch((caught) => setError((caught as Error).message));
  }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  if (!allowed) {
    return <UpgradeCard title={`${name} import is on paid plans`} text={`Bring your whole ${name} library in, with its PDFs and collections. ${planName ? `The ${planName} plan` : 'Your plan'} does not include it.`} onUpgrade={() => onUpgrade()} />;
  }
  if (error) return <p role="alert" className="text-[13.5px] text-[#dc2626]">{error}</p>;
  if (!connections) return <p className="flex items-center gap-2 text-[13.5px] text-[#64748b]"><LuLoader className="h-4 w-4 animate-spin" />Loading…</p>;
  const state = connections[provider];
  if (!state.connected) return <Connect provider={provider} signIn={state.sign_in} onConnected={load} />;
  return <Collections provider={provider} accountName={state.name} folderId={folderId} onDisconnected={load} onChanged={onChanged} />;
}

function Connect({ provider, signIn, onConnected }: { provider: ReferenceProvider; signIn: boolean; onConnected: () => void }) {
  const name = NAMES[provider];
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startSignIn = async () => {
    setBusy('sign-in'); setError(null);
    try {
      const { authorization_url: url } = await startReferenceSignIn(provider, `${window.location.pathname}${window.location.search}`);
      window.location.assign(url);
    } catch (caught) { setError((caught as Error).message); setBusy(null); }
  };
  const connectKey = async () => {
    setBusy('key'); setError(null);
    try { await connectZoteroKey(key.trim()); onConnected(); } catch (caught) { setError((caught as Error).message); } finally { setBusy(null); }
  };

  return (
    <div className="flex max-w-[520px] flex-col gap-4">
      <div>
        <p className="text-[16px] font-semibold text-[#0f172a]">Connect {name}</p>
        <p className="mt-1 text-[14px] leading-relaxed text-[#64748b]">Import your {name} library or one collection, with its PDFs. Videmak only reads it and never changes anything there.</p>
      </div>
      {signIn && (
        <div><button type="button" className={primary} disabled={busy !== null} onClick={() => void startSignIn()}>{busy === 'sign-in' && <LuLoader className="h-4 w-4 animate-spin" />}Connect {name}</button></div>
      )}
      {provider === 'zotero' && (
        <div className={signIn ? 'border-t border-[#f1f5f9] pt-4' : ''}>
          <p className="text-[14px] font-medium text-[#0f172a]">{signIn ? 'Or use an API key' : 'Paste a Zotero API key'}</p>
          <ol className="mt-1.5 list-decimal pl-5 text-[13.5px] leading-relaxed text-[#475569]">
            <li><a href={ZOTERO_NEW_KEY} target="_blank" rel="noreferrer" className="font-semibold text-[var(--theme-primary,#2563eb)] hover:underline">Create a key on zotero.org<LuExternalLink className="ml-1 inline h-3 w-3" /></a> with library access (it is filled in for you).</li>
            <li>Save it, copy the key and paste it here.</li>
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <input value={key} onChange={(event) => setKey(event.target.value)} placeholder="Zotero API key" aria-label="Zotero API key" spellCheck={false} autoComplete="off"
              className="h-10 min-w-0 flex-1 rounded-[10px] border border-[#e2e8f0] px-3 font-mono text-[13px] outline-none focus:border-[var(--theme-primary,#2563eb)] focus:shadow-[0_0_0_3px_#eff6ff]" />
            <button type="button" className={secondary} disabled={busy !== null || key.trim().length < 8} onClick={() => void connectKey()}>{busy === 'key' && <LuLoader className="h-4 w-4 animate-spin" />}Connect</button>
          </div>
        </div>
      )}
      {provider === 'mendeley' && !signIn && (
        <p className="rounded-xl bg-[#f8fafc] px-4 py-3 text-[13.5px] leading-relaxed text-[#475569]">
          Mendeley sign-in is not switched on for this site yet. Meanwhile, in Mendeley Reference Manager choose <b>File › Export All</b> as BibTeX, then use <b>Import .bib/.ris</b>.
        </p>
      )}
      {error && <p role="alert" className="text-[13px] text-[#dc2626]">{error}</p>}
    </div>
  );
}

function Collections({ provider, accountName, folderId, onDisconnected, onChanged }: { provider: ReferenceProvider; accountName: string | null; folderId: string | null; onDisconnected: () => void; onChanged: () => void }) {
  const name = NAMES[provider];
  const [collections, setCollections] = useState<ReferenceCollection[] | null>(null);
  const [libraryItems, setLibraryItems] = useState<number | null>(null);
  const [choice, setChoice] = useState<string>('');
  const [query, setQuery] = useState('');
  const [findPdfs, setFindPdfs] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { job, follow, reset } = useImportJob();
  useEffect(() => { if (job && job.status !== 'running') onChanged(); }, [job, onChanged]);

  useEffect(() => {
    getReferenceCollections(provider)
      .then((result) => { setCollections(result.collections); setLibraryItems(result.library_items); })
      .catch((caught) => setError((caught as Error).message));
  }, [provider]);

  // Nested collections listed under their parent.
  const ordered = useMemo(() => {
    const list = collections ?? [];
    const out: (ReferenceCollection & { depth: number })[] = [];
    const visit = (parent: string | null, depth: number) => {
      for (const item of list.filter((entry) => (entry.parent ?? null) === parent)) { out.push({ ...item, depth }); if (depth < 6) visit(item.id, depth + 1); }
    };
    visit(null, 0);
    for (const item of list) if (!out.some((entry) => entry.id === item.id)) out.push({ ...item, depth: 0 });
    const term = query.trim().toLowerCase();
    return term ? out.filter((item) => item.name.toLowerCase().includes(term)).map((item) => ({ ...item, depth: 0 })) : out;
  }, [collections, query]);

  const start = async () => {
    setBusy(true); setError(null);
    const picked = collections?.find((item) => item.id === choice) ?? null;
    try {
      const started = await startReferenceImport(provider, { collection: picked?.id ?? null, collection_name: picked?.name ?? null, folder_id: folderId, find_pdfs: findPdfs });
      follow(started.job_id);
    } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };
  const disconnect = async () => {
    await disconnectReferenceManager(provider).catch(() => undefined);
    onDisconnected();
  };

  if (job) return <ImportProgress job={job} onAgain={reset} />;
  const option = (id: string, label: string, count: number | null, depth = 0) => (
    <label key={id || 'all'} className={`flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] transition-colors ${choice === id ? 'bg-[#eff6ff]' : 'hover:bg-[#f8fafc]'}`} style={{ paddingLeft: 12 + depth * 18 }}>
      <input type="radio" name={`${provider}-collection`} checked={choice === id} onChange={() => setChoice(id)} className="h-4 w-4 accent-[var(--theme-primary,#2563eb)]" />
      <span className="min-w-0 flex-1 truncate text-[#0f172a]">{label}</span>
      {count !== null && <span className="shrink-0 text-[12.5px] text-[#94a3b8]">{count.toLocaleString('en-US')}</span>}
    </label>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[13.5px] text-[#475569]">
        <span className="h-2 w-2 rounded-full bg-[#16a34a]" />
        <span className="min-w-0 flex-1 truncate">Connected{accountName ? ` as ${accountName}` : ''}</span>
        <button type="button" onClick={() => void disconnect()} className="shrink-0 text-[13px] font-medium text-[#64748b] hover:text-[#dc2626]">Disconnect</button>
      </div>
      {!collections && !error && <p className="flex items-center gap-2 text-[13.5px] text-[#64748b]"><LuLoader className="h-4 w-4 animate-spin" />Reading your {name} collections…</p>}
      {collections && (
        <>
          {collections.length > 8 && (
            <div className="relative">
              <LuSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${plural(collections.length, 'collection')}`} aria-label="Search collections"
                className="h-9 w-full rounded-[10px] border border-[#e2e8f0] pl-9 pr-3 text-[14px] outline-none focus:border-[var(--theme-primary,#2563eb)]" />
            </div>
          )}
          <div className="max-h-[300px] overflow-y-auto rounded-xl border border-[#e2e8f0] p-1.5" role="radiogroup" aria-label={`What to import from ${name}`}>
            {!query && option('', `Whole ${name} library`, libraryItems)}
            {ordered.map((item) => option(item.id, item.name, item.items, item.depth))}
            {collections.length === 0 && <p className="px-3 py-2 text-[13px] text-[#94a3b8]">No collections: the whole library is imported.</p>}
          </div>
          <p className="text-[12.5px] text-[#64748b]">{choice && !folderId ? 'It becomes a Library collection with the same name. ' : ''}Items already in your Library are skipped.</p>
          <FindPdfs value={findPdfs} onChange={setFindPdfs} />
          <div><button type="button" className={primary} disabled={busy} onClick={() => void start()}>{busy && <LuLoader className="h-4 w-4 animate-spin" />}Import from {name}</button></div>
        </>
      )}
      {error && <p role="alert" className="text-[13px] text-[#dc2626]">{error}</p>}
    </div>
  );
}
