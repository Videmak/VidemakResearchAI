-- Plans people subscribe to (Free, Plus, Pro, Team), edited from Admin › Plans. Limits are a
-- JSON object of the keys in src/lib/plans.ts (counts per day/month, totals, on/off features).
create table plans (
  id text primary key,                          -- slug: free, plus, pro, team
  name text not null,
  tagline text not null default '',
  sort_order integer not null default 0,
  is_default boolean not null default false,    -- the plan of everyone without a subscription
  is_public boolean not null default true,      -- shown on pricing
  featured boolean not null default false,      -- "Most popular"
  checkout text not null default 'self_serve',  -- self_serve | contact
  contact_url text,
  monthly_cents integer not null default 0,     -- billed monthly
  yearly_cents integer not null default 0,      -- billed yearly, the whole year
  currency text not null default 'usd',
  trial_days integer not null default 0,
  limits jsonb not null default '{}',
  stripe_product_id text,
  stripe_monthly_price_id text,
  stripe_yearly_price_id text,
  stripe_mode text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table plan_features (
  id bigserial primary key,
  plan_id text not null references plans(id) on delete cascade,
  label text not null,
  included boolean not null default true,
  sort_order integer not null default 0
);
create index plan_features_plan on plan_features (plan_id, sort_order);

-- The plan subscription (separate from the pay-as-you-go API-key subscription in
-- stripe_subscription_id). plan_source: default (no plan), stripe (a subscription), admin (given).
alter table accounts
  add column plan_subscription_id text,
  add column plan_status text not null default 'none',
  add column plan_interval text,
  add column plan_period_end timestamptz,
  add column plan_cancel_at_period_end boolean not null default false,
  add column plan_source text not null default 'default',
  add column plan_event_at timestamptz;

-- Counted uses for plan limits: period is a UTC day (2026-10-29) or month (2026-10).
create table plan_usage (
  account_id uuid not null references accounts(id) on delete cascade,
  key text not null,
  period text not null,
  amount integer not null default 0,
  primary key (account_id, key, period)
);
