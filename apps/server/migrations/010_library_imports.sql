-- Library imports: Zotero and Mendeley connections, import progress, and per-plan upload limits.

-- One connection per person and service. Credentials (API key, OAuth tokens) are encrypted with
-- the settings key before they are stored.
create table library_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('zotero', 'mendeley')),
  external_user_id text,
  display_name text,
  credentials_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_import_at timestamptz,
  unique (user_id, provider)
);

-- A Zotero/Mendeley/.bib/.ris/ID import running in the background, so the browser can show progress.
create table library_import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  source text not null check (source in ('zotero', 'mendeley', 'bibtex', 'ris', 'ids')),
  label text not null default '',
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  total integer not null default 0,
  added integer not null default 0,
  pdfs integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  pdfs_over_limit integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index library_import_jobs_user on library_import_jobs (user_id, created_at desc);

-- Where an imported item came from ("zotero:ABCD1234"), so importing again skips it.
alter table library_documents add column external_id text;
create unique index library_documents_external on library_documents (user_id, external_id) where external_id is not null;

-- The new plan limits, for plans created before them (an admin can change them in Admin › Plans).
update plans set limits = limits || '{"upload_mb": 10, "upload_batch": 5, "zotero_import": false, "mendeley_import": false}'::jsonb
  where id = 'free' and not limits ? 'upload_mb';
update plans set limits = limits || '{"upload_mb": 50, "upload_batch": 20, "zotero_import": true, "mendeley_import": true}'::jsonb
  where id in ('plus', 'classic-researcher', 'classic-basic', 'classic-annual', 'classic-group') and not limits ? 'upload_mb';
update plans set limits = limits || '{"upload_mb": null, "upload_batch": null, "zotero_import": true, "mendeley_import": true}'::jsonb
  where not limits ? 'upload_mb';

insert into plan_features (plan_id, label, included, sort_order)
  select 'free', 'Zotero and Mendeley import', false, 100 where exists (select 1 from plans where id = 'free')
    and not exists (select 1 from plan_features where plan_id = 'free' and label ilike '%zotero%');
insert into plan_features (plan_id, label, included, sort_order)
  select id, 'Zotero and Mendeley import', true, 100 from plans p where id in ('plus', 'pro')
    and not exists (select 1 from plan_features f where f.plan_id = p.id and f.label ilike '%zotero%');
