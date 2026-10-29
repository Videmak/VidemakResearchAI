-- Stripe webhook events already handled (Stripe retries and may send an event more than once).
create table stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- Billing state per account, kept in step by the webhook. billing_event_at is the Stripe time
-- of the event that set it, so an older event arriving late never overwrites a newer state.
alter table accounts add column billing_status text not null default 'none';
alter table accounts add column billing_event_at timestamptz;
