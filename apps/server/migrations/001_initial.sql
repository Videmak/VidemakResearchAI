-- Videmak initial schema. Ids are uuid text; timestamps are timestamptz.
create extension if not exists vector;
create extension if not exists pgcrypto;

-- Billing entity: one per person today, teams later.
create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  plan text not null default 'free',
  stripe_customer_id text unique,
  spend_cap_cents integer not null default 5000,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  email text not null unique,
  full_name text,
  password_hash text,
  email_verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table documents (
  id text primary key,
  owner_user_id uuid not null references users(id) on delete cascade,
  title text not null default 'Untitled document',
  blocks jsonb not null default '[]',          -- readable copy of the live Yjs document
  ydoc bytea,                                   -- the live document (Yjs state), source of truth
  comments jsonb not null default '[]',
  share_settings jsonb not null default '{}',
  activity jsonb not null default '[]',
  word_settings jsonb,
  word_count integer not null default 0,
  search tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_owner_updated on documents (owner_user_id, updated_at desc);
create index documents_search on documents using gin (search);

create table document_members (
  id bigserial primary key,
  document_id text not null references documents(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  invite_email text not null,
  display_name text,
  role text not null default 'editor',          -- editor | commenter | viewer
  status text not null default 'pending',       -- pending | active
  invited_by_user_id uuid not null references users(id),
  invite_sent boolean not null default false,
  created_at timestamptz not null default now(),
  unique (document_id, invite_email)
);
create index document_members_user on document_members (user_id);

create table document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id text not null references documents(id) on delete cascade,
  author_user_id uuid references users(id) on delete set null,
  author_name text not null default '',
  reason text not null default 'auto',          -- auto | import | manual | before-restore | restore
  label text,
  title text not null default '',
  blocks jsonb not null,
  word_settings jsonb,
  word_count integer not null default 0,
  block_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index document_versions_doc on document_versions (document_id, created_at desc);

create table chat_threads (
  id uuid primary key default gen_random_uuid(),
  document_id text references documents(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  title text not null default 'New chat',
  messages jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chat_threads_user_doc on chat_threads (user_id, document_id, updated_at desc);

create table library_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  parent_id uuid references library_folders(id) on delete cascade,
  source text not null default 'local',
  created_at timestamptz not null default now()
);

create table library_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  folder_id uuid references library_folders(id) on delete set null,
  filename text not null,
  file_type text not null default 'pdf',
  file_path text,
  file_size integer,
  title text,
  authors jsonb not null default '[]',
  doi text,
  publisher text,
  publication_date text,
  abstract text,
  metadata jsonb not null default '{}',
  processing_status text not null default 'pending',
  processing_error text,
  chunk_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);
create index library_documents_user on library_documents (user_id, created_at desc);
create unique index library_documents_user_doi on library_documents (user_id, lower(doi)) where doi is not null;

-- Every chunk records the embedding model that made it; searches use the same model.
create table library_chunks (
  id bigserial primary key,
  document_id uuid not null references library_documents(id) on delete cascade,
  chunk_index integer not null,
  page integer,
  content text not null,
  embedding vector(384),
  embedding_model text,
  search tsvector generated always as (to_tsvector('simple', content)) stored
);
create index library_chunks_doc on library_chunks (document_id, chunk_index);
create index library_chunks_search on library_chunks using gin (search);

create table assets (
  id text primary key,                          -- sha256 prefix + extension
  user_id uuid references users(id) on delete set null,
  content_type text not null,
  size integer not null,
  created_at timestamptz not null default now()
);

-- Videmak Cloud: API keys and metering.
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null default 'Default key',
  prefix text not null,                         -- first characters, shown in the dashboard
  key_hash text not null unique,                -- sha256 of the full key; the key itself is never stored
  mode text not null default 'test',            -- test | live
  spend_cap_cents integer,
  allowed_services text[],
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index api_keys_account on api_keys (account_id);

create table usage_events (
  id bigserial primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  api_key_id uuid references api_keys(id) on delete set null,
  service text not null,
  quantity numeric not null,
  request_id text not null,
  metadata jsonb not null default '{}',
  reported_at timestamptz,                      -- when it was sent to Stripe
  created_at timestamptz not null default now(),
  unique (request_id, service)
);
create index usage_events_account_time on usage_events (account_id, created_at desc);
create index usage_events_unreported on usage_events (reported_at) where reported_at is null;
