-- Accounts imported from a previous app (for videmak.net: the Laravel "Videmak Research AI").
-- legacy_id is the old user id; their old work is archived and can be requested by email.
alter table users
  add column legacy_id bigint unique,
  add column legacy_reset_sent_at timestamptz;
