-- Newsletter on MailCheap: each person's choice and what MailCheap was last told.
alter table users add column newsletter_opt_out boolean not null default false;
-- Changed on the account page and not yet sent to MailCheap.
alter table users add column newsletter_dirty boolean not null default false;
-- MailCheap's status for this person ('active', 'unsubscribed', 'bounced', 'complained'); null = never sent.
alter table users add column newsletter_synced text;
alter table users add column newsletter_synced_at timestamptz;
alter table users add column newsletter_error text;
create index users_newsletter_waiting on users (created_at) where newsletter_synced is null and email_verified_at is not null;
create index users_newsletter_dirty on users (id) where newsletter_dirty;
