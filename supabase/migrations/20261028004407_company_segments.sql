begin;

-- Saved audiences are evaluated against current company profiles.
-- Like other CRM tables, access is server-only after workspace authorization.
create table public.company_segments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120 and name = btrim(name)),
  description text not null default '' check (char_length(description) <= 500),
  rules jsonb not null default '{}'::jsonb check (
    jsonb_typeof(rules) = 'object'
    and rules - array['businessSegment','country','source','stage','minFitScore','hasEmail'] = '{}'::jsonb
  ),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index company_segments_name_key on public.company_segments (lower(name));
alter table public.company_segments enable row level security;
revoke all on public.company_segments from public, anon, authenticated;
grant all on public.company_segments to service_role;
comment on table public.company_segments is 'Server-only saved CRM audiences. Server actions validate active workspace membership and writer roles; browsers have no direct access.';

commit;
