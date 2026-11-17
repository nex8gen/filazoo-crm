begin;
create table public.workspace_portal_designs (
  workspace_id uuid not null default crm_tenancy.workspace_id() references public.workspaces(id) on delete cascade,
  singleton boolean not null default true check (singleton),
  draft jsonb not null check (jsonb_typeof(draft) = 'object'),
  published jsonb check (published is null or jsonb_typeof(published) = 'object'),
  revision integer not null default 1 check (revision > 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  primary key (workspace_id, singleton),
  check ((published is null) = (published_at is null))
);
alter table public.workspace_portal_designs enable row level security;
revoke all on public.workspace_portal_designs from public, anon, authenticated;
grant select, insert, update on public.workspace_portal_designs to crm_workspace_server, service_role;
create policy portal_design_read on public.workspace_portal_designs for select to crm_workspace_server
  using (workspace_id = (select crm_tenancy.workspace_id()));
create policy portal_design_insert on public.workspace_portal_designs for insert to crm_workspace_server
  with check (workspace_id = (select crm_tenancy.workspace_id()) and exists (
    select 1 from public.workspace_members m where m.workspace_id = workspace_portal_designs.workspace_id
      and m.user_id = nullif(nullif(current_setting('request.headers', true), '')::jsonb->>'x-crm-user-id', '')::uuid
      and m.role = 'admin' and m.activated_at is not null
  ));
create policy portal_design_update on public.workspace_portal_designs for update to crm_workspace_server
  using (workspace_id = (select crm_tenancy.workspace_id()) and exists (
    select 1 from public.workspace_members m where m.workspace_id = workspace_portal_designs.workspace_id
      and m.user_id = nullif(nullif(current_setting('request.headers', true), '')::jsonb->>'x-crm-user-id', '')::uuid
      and m.role = 'admin' and m.activated_at is not null
  ))
  with check (workspace_id = (select crm_tenancy.workspace_id()) and exists (
    select 1 from public.workspace_members m where m.workspace_id = workspace_portal_designs.workspace_id
      and m.user_id = nullif(nullif(current_setting('request.headers', true), '')::jsonb->>'x-crm-user-id', '')::uuid
      and m.role = 'admin' and m.activated_at is not null
  ));
notify pgrst, 'reload schema';
commit;
