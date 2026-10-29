-- Videmak Cloud runs on prepaid credits (the same credit as CitedEvidence Scholar: one paper or
-- file request) instead of a monthly metered invoice. Balances are kept in thousandths of a
-- credit so AI calls, which cost a fraction of a credit, are charged exactly.
alter table accounts
  add column credits_milli bigint not null default 0,
  add column starter_granted_at timestamptz,
  add column topup_enabled boolean not null default false,
  add column topup_threshold integer not null default 500,        -- credits; top up when the balance falls below
  add column topup_pack text not null default 'credits_2000',
  add column topup_monthly_limit_cents integer not null default 10000,
  add column topup_error text,
  add column low_balance_noticed_at timestamptz,
  drop column spend_cap_cents,
  drop column stripe_subscription_id;

alter table api_keys
  add column monthly_credit_cap integer,                          -- null: no cap for this key
  drop column spend_cap_cents;

-- What each call cost: taken from the day's free credits first, then the paid balance.
alter table usage_events
  add column free_milli bigint not null default 0,
  add column paid_milli bigint not null default 0,
  drop column reported_at;
update usage_events set service = 'files_requests' where service = 'fulltext_pages';
delete from usage_events where service = 'sync_editors';
create index usage_events_key_time on usage_events (api_key_id, created_at desc) where api_key_id is not null;

-- Every credit that comes in: purchases, automatic top-ups, the starter amount, admin grants.
create table credit_ledger (
  id bigserial primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  kind text not null check (kind in ('purchase', 'topup', 'starter', 'grant', 'refund')),
  credits_milli bigint not null,
  amount_cents integer,
  reference text unique,                                         -- Stripe session or payment id; makes each grant happen once
  note text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index credit_ledger_account on credit_ledger (account_id, created_at desc);

-- Free credits used per account per day (UTC); they reset at midnight and do not roll over.
create table credit_daily_free (
  account_id uuid not null references accounts(id) on delete cascade,
  day date not null,
  used_milli bigint not null default 0,
  primary key (account_id, day)
);

drop table stripe_catalog;
