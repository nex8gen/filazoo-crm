-- Server-only policy storage: members cannot elevate AI permissions via the Data API.
create table public.workspace_ai_settings (
  singleton boolean primary key default true check (singleton),
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  revision integer not null default 1 check (revision > 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.workspace_ai_settings enable row level security;
revoke all on public.workspace_ai_settings from public, anon, authenticated;
grant select, insert, update on public.workspace_ai_settings to service_role;
