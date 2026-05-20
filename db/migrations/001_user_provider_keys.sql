create table if not exists user_provider_keys (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null,
  provider text not null check (provider in ('openai', 'elevenlabs')),
  encrypted_key text not null,
  iv text not null,
  auth_tag text not null,
  key_hint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clerk_user_id, provider)
);

