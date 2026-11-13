-- Sign in with CitedEvidence: CitedEvidence becomes a sign-in provider, and (when accounts and
-- plans live there) its plan decides who may use Videmak.

alter table user_identities drop constraint user_identities_provider_check;
alter table user_identities add constraint user_identities_provider_check
  check (provider in ('google', 'microsoft', 'apple', 'citedevidence'));

-- One row per person signed in with CitedEvidence: the plan as last read from its userinfo
-- endpoint, and the refresh token (encrypted with the settings key) used to read it again.
-- plan_checked_at is the last successful read; attempted_at the last try (one an hour at most).
create table citedevidence_links (
  user_id uuid primary key references users(id) on delete cascade,
  subject text not null unique,
  email text,
  plan_name text,
  plan_tier text,
  plan_active boolean not null default false,
  plan_admin boolean not null default false,
  refresh_token_encrypted text,
  plan_checked_at timestamptz,
  attempted_at timestamptz,
  check_error text,
  created_at timestamptz not null default now()
);
