create table public.ai_lead_buyer_profiles (
  workspace_id uuid not null default crm_tenancy.workspace_id() references public.workspaces(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  context_key text not null,
  created_by uuid not null references auth.users(id),
  status text not null default 'running' check(status in ('running','complete','failed')),
  profile jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(workspace_id,id),
  unique(workspace_id,context_key)
);
alter table public.ai_lead_buyer_profiles enable row level security;
revoke all on public.ai_lead_buyer_profiles from anon,authenticated;
grant select,insert,update,delete on public.ai_lead_buyer_profiles to crm_workspace_server,service_role;
create policy crm_workspace_isolation on public.ai_lead_buyer_profiles to crm_workspace_server
  using(workspace_id=(select crm_tenancy.workspace_id())) with check(workspace_id=(select crm_tenancy.workspace_id()));
notify pgrst,'reload schema';
