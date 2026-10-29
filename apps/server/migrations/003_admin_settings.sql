alter table users add column is_admin boolean not null default false;

-- Provider keys and options set from the admin page. Secret values are AES-256-GCM encrypted.
create table app_settings (
  key text primary key,
  value_encrypted text not null,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Who changed which setting and when (never the value).
create table admin_audit (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  action text not null,
  target text,
  created_at timestamptz not null default now()
);
