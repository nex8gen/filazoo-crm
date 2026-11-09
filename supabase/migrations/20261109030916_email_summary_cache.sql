-- Content-addressed briefs survive navigation, browser reloads and server restarts.
create table public.email_summary_cache (
  workspace_id uuid not null default crm_tenancy.workspace_id() references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  output text check (length(output) <= 100000),
  generated_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  primary key (workspace_id,user_id,input_hash),
  check ((output is null) = (generated_at is null))
);
alter table public.email_summary_cache enable row level security;
revoke all on public.email_summary_cache from public,anon,authenticated;
grant select,insert,update,delete on public.email_summary_cache to crm_workspace_server,service_role;
create policy crm_workspace_isolation on public.email_summary_cache to crm_workspace_server
  using (workspace_id=(select crm_tenancy.workspace_id()))
  with check (workspace_id=(select crm_tenancy.workspace_id()));
notify pgrst,'reload schema';
