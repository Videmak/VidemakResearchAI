-- Sign in with Google, Microsoft and Apple, and with passkeys. One account per email: a
-- provider's verified email links to the account that already has it.

create table user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft', 'apple')),
  subject text not null,
  email text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (provider, subject),
  unique (user_id, provider)
);

create table user_passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  credential_id text not null unique,
  public_key bytea not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_type text,
  backed_up boolean not null default false,
  name text not null default 'Passkey',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index user_passkeys_user on user_passkeys (user_id);

-- Short-lived sign-in steps: an OAuth round trip (state, PKCE verifier, nonce), a passkey
-- challenge, or the one-time ticket the browser trades for a session. Used once.
create table auth_flows (
  id text primary key,
  kind text not null,
  provider text,
  data jsonb not null default '{}',
  user_id uuid references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index auth_flows_expiry on auth_flows (expires_at);
