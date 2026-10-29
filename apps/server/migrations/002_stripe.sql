-- Stripe objects created for each metered service (one meter + one metered price each).
create table stripe_catalog (
  service text primary key,
  event_name text not null,
  meter_id text not null,
  price_id text not null,
  mode text not null default 'test',
  created_at timestamptz not null default now()
);
alter table accounts add column stripe_subscription_id text;
