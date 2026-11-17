begin;
create table public.workspace_portal_domains (
  workspace_id uuid primary key default crm_tenancy.workspace_id() references public.workspaces(id) on delete cascade,
  hostname text not null unique check (hostname = lower(hostname) and length(hostname) between 4 and 253 and hostname ~ '^[a-z0-9.-]+$'),
  status text not null default 'pending_dns' check (status in ('pending_dns','pending_ssl','connected','disconnecting')),
  verification_token text not null check (verification_token ~ '^[a-f0-9]{48}$'),
  records jsonb not null default '[]'::jsonb check (jsonb_typeof(records) = 'array'),
  provider_added boolean not null default false,
  checked_at timestamptz,
  message text,
  operation_token uuid,
  operation_until timestamptz,
  created_at timestamptz not null default now(),
  check ((operation_token is null) = (operation_until is null)),
  check (status <> 'connected' or provider_added)
);
alter table public.workspace_portal_domains enable row level security;
revoke all on public.workspace_portal_domains from public, anon, authenticated;
grant select, insert, update, delete on public.workspace_portal_domains to crm_workspace_server, service_role;
create policy portal_domain_read on public.workspace_portal_domains for select to crm_workspace_server
  using (workspace_id = (select crm_tenancy.workspace_id()));
create policy portal_domain_admin on public.workspace_portal_domains for all to crm_workspace_server
  using (workspace_id = (select crm_tenancy.workspace_id()) and exists (
    select 1 from public.workspace_members m where m.workspace_id = workspace_portal_domains.workspace_id
      and m.user_id = nullif(nullif(current_setting('request.headers', true), '')::jsonb->>'x-crm-user-id', '')::uuid
      and m.role = 'admin' and m.activated_at is not null
  ))
  with check (workspace_id = (select crm_tenancy.workspace_id()) and exists (
    select 1 from public.workspace_members m where m.workspace_id = workspace_portal_domains.workspace_id
      and m.user_id = nullif(nullif(current_setting('request.headers', true), '')::jsonb->>'x-crm-user-id', '')::uuid
      and m.role = 'admin' and m.activated_at is not null
  ));
notify pgrst, 'reload schema';
commit;
