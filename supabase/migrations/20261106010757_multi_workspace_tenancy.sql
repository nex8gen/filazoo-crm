-- Coordinate this migration with the application release: upsert keys become tenant-scoped.
-- No customer data is deleted. Existing rows and integrations stay in the legacy workspace.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Abort the rollout if assigning existing rows to the original workspace changes a count.
create temporary table rollout_row_counts(name text primary key, expected bigint) on commit drop;
do $$ declare r record; n bigint; begin
  for r in select tablename from pg_tables where schemaname='public' loop
    execute format('select count(*) from public.%I',r.tablename) into n;
    insert into rollout_row_counts values(r.tablename,n);
  end loop;
end $$;

create schema if not exists crm_tenancy;
revoke all on schema crm_tenancy from public, anon, authenticated;
create role crm_workspace_server nologin noinherit nobypassrls;
grant crm_workspace_server to service_role, authenticator;
grant usage on schema public, crm_tenancy to crm_workspace_server, service_role;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  owner_id uuid references auth.users(id) on delete restrict,
  is_legacy boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index workspaces_one_legacy on public.workspaces(is_legacy) where is_legacy;
alter table public.workspaces enable row level security;
revoke all on public.workspaces from anon, authenticated;
grant all on public.workspaces to service_role;
insert into public.workspaces(name,slug,owner_id,is_legacy)
values ('Filazoo','filazoo', (select user_id from public.workspace_members where role='admin' and activated_at is not null order by created_at limit 1),true);

create function crm_tenancy.workspace_id() returns uuid
language sql stable security invoker set search_path='' as $$
  select coalesce(nullif(current_setting('crm.workspace_id',true),'')::uuid,
    (select id from public.workspaces where is_legacy));
$$;
grant execute on function crm_tenancy.workspace_id() to service_role, crm_workspace_server;

-- Capture references before converting keys; restore every relationship with the tenant ID.
create temporary table crm_tenant_fks on commit drop as
select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
from pg_constraint where contype='f' and connamespace='public'::regnamespace
  and confrelid in (select oid from pg_class where relnamespace='public'::regnamespace and relname<>'workspaces');
create temporary table crm_tenant_unique_indexes on commit drop as
select indexname, indexdef from pg_indexes i where schemaname='public'
  and tablename<>'workspaces' and indexdef like 'CREATE UNIQUE%'
  and not exists(select 1 from pg_constraint c where c.conindid=(quote_ident(i.schemaname)||'.'||quote_ident(i.indexname))::regclass);

do $$ declare r record; legacy uuid; definition text; begin
  select id into legacy from public.workspaces where is_legacy;
  for r in select * from crm_tenant_fks loop execute format('alter table public.%I drop constraint %I',r.tbl,r.conname); end loop;
  for r in select tablename from pg_tables where schemaname='public' and tablename<>'workspaces' loop
    execute format('alter table public.%I add column workspace_id uuid not null default %L references public.workspaces(id) on delete restrict',r.tablename,legacy);
    execute format('alter table public.%I alter column workspace_id set default crm_tenancy.workspace_id()',r.tablename);
    execute format('create index %I on public.%I(workspace_id)',r.tablename||'_workspace_idx',r.tablename);
    execute format('alter table public.%I enable row level security',r.tablename);
    execute format('create policy crm_workspace_isolation on public.%I to crm_workspace_server using (workspace_id = (select crm_tenancy.workspace_id())) with check (workspace_id = (select crm_tenancy.workspace_id()))',r.tablename);
    execute format('grant select,insert,update,delete on public.%I to crm_workspace_server',r.tablename);
  end loop;
  for r in select conrelid::regclass::text tbl,conname,pg_get_constraintdef(oid) def
    from pg_constraint where connamespace='public'::regnamespace and contype in ('p','u') and conrelid<>'public.workspaces'::regclass loop
    definition := regexp_replace(r.def,'\(', '(workspace_id, ');
    execute format('alter table public.%I drop constraint %I, add constraint %I %s',r.tbl,r.conname,r.conname,definition);
  end loop;
  for r in select * from crm_tenant_unique_indexes loop
    execute format('drop index public.%I',r.indexname);
    execute regexp_replace(r.indexdef,'USING btree \(', 'USING btree (workspace_id, ');
  end loop;
  for r in select * from crm_tenant_fks loop
    definition := regexp_replace(r.def,'FOREIGN KEY \(([^)]+)\)', 'FOREIGN KEY (workspace_id, \1)');
    definition := regexp_replace(definition,'REFERENCES ([^ (]+)\(([^)]+)\)', 'REFERENCES \1(workspace_id, \2)');
    -- SET NULL must preserve the non-null workspace key (Postgres 15+ column list).
    if definition like '%ON DELETE SET NULL%' then
      definition := replace(definition,'ON DELETE SET NULL','ON DELETE SET NULL ('||substring(r.def from 'FOREIGN KEY \(([^)]+)\)')||')');
    end if;
    execute format('alter table public.%I add constraint %I %s',r.tbl,r.conname,definition);
  end loop;
  -- Existing atomic RPCs/triggers are invokers and therefore inherit tenant RLS.
  -- Adapt their conflict targets to the composite keys above, including partial indexes.
  for r in select p.oid,pg_get_functiondef(p.oid) def from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' loop
    if r.def ~* 'on\s+conflict\s*\(' then
      execute regexp_replace(r.def,'(on\s+conflict\s*\()','\1workspace_id, ','gi');
    end if;
    if (select prosecdef from pg_proc where oid=r.oid) then
      raise exception 'Review SECURITY DEFINER function % before enabling tenancy',r.oid::regprocedure;
    end if;
    execute format('grant execute on function %s to crm_workspace_server',r.oid::regprocedure);
  end loop;
end $$;
grant usage,select on all sequences in schema public to crm_workspace_server;
grant select on public.workspaces to crm_workspace_server;
create policy crm_workspace_identity on public.workspaces to crm_workspace_server using(id=nullif(current_setting('crm.workspace_id',true),'')::uuid);
-- Vault privileges remain unchanged. Private capabilities bind secret reads/updates
-- to credential IDs already referenced by this workspace's ERP settings.
create function crm_tenancy.erp_secrets() returns table(id uuid,decrypted_secret text)
language sql stable security definer set search_path='' as $$
  select v.id,v.decrypted_secret from vault.decrypted_secrets v
  join public.erp_connection_settings s on v.id in (s.app_secret_id,s.worker_secret_id)
  where s.workspace_id=nullif(current_setting('crm.workspace_id',true),'')::uuid;
$$;
create function crm_tenancy.create_erp_secret(p_value text,p_name text,p_description text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.workspaces where id=nullif(current_setting('crm.workspace_id',true),'')::uuid) then raise insufficient_privilege; end if;
  return vault.create_secret(p_value,null,p_description);
end $$;
create function crm_tenancy.update_erp_secret(p_id uuid,p_value text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.erp_connection_settings s where s.workspace_id=nullif(current_setting('crm.workspace_id',true),'')::uuid and p_id in (s.app_secret_id,s.worker_secret_id)) then raise insufficient_privilege; end if;
  perform vault.update_secret(p_id,p_value);
end $$;
revoke all on function crm_tenancy.erp_secrets(),crm_tenancy.create_erp_secret(text,text,text),crm_tenancy.update_erp_secret(uuid,text) from public,anon,authenticated;
grant execute on function crm_tenancy.erp_secrets(),crm_tenancy.create_erp_secret(text,text,text),crm_tenancy.update_erp_secret(uuid,text) to crm_workspace_server;
grant usage on schema extensions,net to crm_workspace_server;
do $$ declare r record; d text; begin
  for r in select p.oid,pg_get_functiondef(p.oid) def from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('read_erp_connection','save_erp_connection','erp_worker_authorized','dispatch_erp_inventory_sync') loop
    d:=replace(r.def,'vault.decrypted_secrets','crm_tenancy.erp_secrets()');
    d:=replace(d,'vault.create_secret(','crm_tenancy.create_erp_secret(');
    d:=replace(d,'vault.update_secret(','crm_tenancy.update_erp_secret(');
    execute d;
  end loop;
end $$;

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check(email=lower(btrim(email))),
  display_name text not null check(length(display_name) between 2 and 80),
  role text not null check(role in ('admin','operator','bd_manager','viewer')),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now()+interval '7 days',
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index workspace_invitation_pending on public.workspace_invitations(workspace_id,email) where accepted_at is null and revoked_at is null;
create index workspace_invitation_workspace_idx on public.workspace_invitations(workspace_id);
alter table public.workspace_invitations enable row level security;
revoke all on public.workspace_invitations from anon,authenticated;
grant all on public.workspace_invitations to service_role;

-- Service credentials are downgraded for all record access. Browsers cannot select this role
-- or spoof a control request: the original verified JWT role must be service_role.
create function crm_tenancy.pre_request() returns void language plpgsql security invoker set search_path='' as $$
declare h jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb; tenant uuid; actor uuid;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then return; end if;
  if h->>'x-crm-control'='1' then return; end if;
  tenant := coalesce(nullif(h->>'x-crm-workspace-id','')::uuid,(select id from public.workspaces where is_legacy));
  if not exists(select 1 from public.workspaces where id=tenant) then raise insufficient_privilege using message='Workspace not found'; end if;
  actor := nullif(h->>'x-crm-user-id','')::uuid;
  if actor is not null and not exists(select 1 from public.workspace_members where workspace_id=tenant and user_id=actor and activated_at is not null) then
    raise insufficient_privilege using message='Workspace access has been revoked';
  end if;
  perform set_config('crm.workspace_id',tenant::text,true);
  perform set_config('role','crm_workspace_server',true);
end $$;
revoke all on function crm_tenancy.pre_request() from public;
grant usage on schema crm_tenancy to anon,authenticated;
grant execute on function crm_tenancy.pre_request() to anon,authenticated,service_role;
alter role authenticator set pgrst.db_pre_request='crm_tenancy.pre_request';

-- Session and provisioning functions are control-plane APIs, never granted to tenant role.
create function public.read_workspace_session(p_user_id uuid,p_session_id uuid,p_workspace_id uuid default null)
returns table(id uuid,email text,user_metadata jsonb,role text,display_name text,activated_at timestamptz,workspace_id uuid,workspace_name text,owner_id uuid)
language sql stable security invoker set search_path='' as $$
  select u.id,u.email::text,u.raw_user_meta_data,m.role,m.display_name,m.activated_at,w.id,w.name,w.owner_id
  from auth.users u join auth.sessions s on s.user_id=u.id and s.id=p_session_id
  left join lateral (
    select wm.* from public.workspace_members wm where wm.user_id=u.id and wm.activated_at is not null
      and (p_workspace_id is null or wm.workspace_id=p_workspace_id)
    order by wm.created_at,wm.workspace_id limit 1
  ) m on true left join public.workspaces w on w.id=m.workspace_id
  where u.id=p_user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
    and (s.not_after is null or s.not_after>now());
$$;
-- Access to auth tables stays in a private, service-only definer, like the existing session reader.
alter function public.read_workspace_session(uuid,uuid,uuid) set schema crm_tenancy;
alter function crm_tenancy.read_workspace_session(uuid,uuid,uuid) security definer;
revoke all on function crm_tenancy.read_workspace_session(uuid,uuid,uuid) from public;
grant execute on function crm_tenancy.read_workspace_session(uuid,uuid,uuid) to service_role;
create function public.read_workspace_session(p_user_id uuid,p_session_id uuid,p_workspace_id uuid default null)
returns table(id uuid,email text,user_metadata jsonb,role text,display_name text,activated_at timestamptz,workspace_id uuid,workspace_name text,owner_id uuid)
language sql stable security invoker set search_path='' as $$ select * from crm_tenancy.read_workspace_session(p_user_id,p_session_id,p_workspace_id); $$;

create function public.create_crm_workspace(p_user_id uuid,p_name text,p_slug text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare tenant uuid; member_name text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select display_name into member_name from crm_tenancy.verified_user(p_user_id);
  if not found then raise exception 'Verify your email before creating a workspace'; end if;
  if (select count(*) from public.workspaces where owner_id=p_user_id)>=10 then raise exception 'Workspace limit reached'; end if;
  insert into public.workspaces(name,slug,owner_id) values(btrim(p_name),p_slug,p_user_id) returning id into tenant;
  perform set_config('crm.workspace_id',tenant::text,true);
  perform set_config('role','crm_workspace_server',true);
  insert into public.workspace_members(workspace_id,user_id,role,display_name,activated_at) values(tenant,p_user_id,'admin',member_name,now());
  insert into public.ai_budget_policy(id) values(true);
  return tenant;
end $$;

create function crm_tenancy.verified_user(p_user_id uuid) returns table(email text,display_name text)
language sql stable security definer set search_path='' as $$
  select lower(u.email::text),coalesce(nullif(btrim(u.raw_user_meta_data->>'display_name'),''),split_part(u.email,'@',1)) from auth.users u where u.id=p_user_id and u.email_confirmed_at is not null
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now());
$$;
revoke all on function crm_tenancy.verified_user(uuid) from public;
grant execute on function crm_tenancy.verified_user(uuid) to service_role;

create function public.accept_workspace_invitation(p_user_id uuid,p_token_hash text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare invitation public.workspace_invitations; verified_email text;
begin
  select email into verified_email from crm_tenancy.verified_user(p_user_id);
  select * into invitation from public.workspace_invitations where token_hash=p_token_hash for update;
  if invitation.id is null or invitation.revoked_at is not null or invitation.accepted_at is not null or invitation.expires_at<=now()
    or verified_email is distinct from invitation.email then raise exception 'This invitation is invalid, expired, or belongs to another email'; end if;
  update public.workspace_invitations set accepted_at=now() where id=invitation.id;
  perform set_config('crm.workspace_id',invitation.workspace_id::text,true);
  perform set_config('role','crm_workspace_server',true);
  insert into public.workspace_members(workspace_id,user_id,role,display_name,activated_at,auto_assign_leads)
    values(invitation.workspace_id,p_user_id,invitation.role,invitation.display_name,now(),invitation.role='bd_manager')
    on conflict(workspace_id,user_id) do nothing;
  return invitation.workspace_id;
end $$;

-- A workspace's owner must always retain administrator access. Owner transfer is explicit.
create function public.transfer_crm_workspace(p_workspace_id uuid,p_actor_id uuid,p_target_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.workspaces where id=p_workspace_id and owner_id=p_actor_id for update;
  if not found or p_actor_id=p_target_id then raise exception 'Owner access required'; end if;
  perform 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_target_id and activated_at is not null for update;
  if not found then raise exception 'An active workspace member is required'; end if;
  update public.workspaces set owner_id=p_target_id,updated_at=now() where id=p_workspace_id;
  perform set_config('crm.workspace_id',p_workspace_id::text,true);
  perform set_config('role','crm_workspace_server',true);
  update public.workspace_members set role='admin',auto_assign_leads=false where user_id=p_target_id;
end $$;

create function public.leave_crm_workspace(p_workspace_id uuid,p_user_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.workspaces where id=p_workspace_id and owner_id<>p_user_id for update;
  if not found then raise exception 'Transfer ownership before leaving'; end if;
  perform set_config('crm.workspace_id',p_workspace_id::text,true);
  perform set_config('crm.allow_leave','true',true);
  perform set_config('role','crm_workspace_server',true);
  return public.remove_workspace_member(p_user_id,p_user_id);
end $$;
do $$ declare d text; begin
  select pg_get_functiondef('public.remove_workspace_member(uuid,uuid)'::regprocedure) into d;
  d := replace(d, 'if not exists(select 1 from public.workspace_members where user_id = p_actor_id and role = ''admin'' and activated_at is not null) then',
    'if not (p_actor_id=p_user_id and current_setting(''crm.allow_leave'',true)=''true'') and not exists(select 1 from public.workspace_members where user_id = p_actor_id and role = ''admin'' and activated_at is not null) then');
  d := replace(d,'if p_user_id = p_actor_id then','if p_user_id = p_actor_id and current_setting(''crm.allow_leave'',true) is distinct from ''true'' then');
  execute d;
end $$;
revoke all on function public.transfer_crm_workspace(uuid,uuid,uuid),public.leave_crm_workspace(uuid,uuid) from public,anon,authenticated,crm_workspace_server;
grant execute on function public.transfer_crm_workspace(uuid,uuid,uuid),public.leave_crm_workspace(uuid,uuid) to service_role;

create function crm_tenancy.protect_owner() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.workspaces w where w.id=old.workspace_id and w.owner_id=old.user_id)
    and (tg_op='DELETE' or new.role<>'admin' or new.activated_at is null or new.user_id<>old.user_id or new.workspace_id<>old.workspace_id) then
    raise exception 'Transfer workspace ownership before removing or demoting the owner';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger workspace_owner_protection before update or delete on public.workspace_members for each row execute function crm_tenancy.protect_owner();
grant execute on function crm_tenancy.protect_owner() to service_role,crm_workspace_server;

-- Preserve the old reader for the existing deployment during the coordinated rollout.
do $$ declare d text; begin
  select pg_get_functiondef('crm_auth_private.read_crm_session(uuid,uuid)'::regprocedure) into d;
  execute replace(d,'m.user_id = u.id','m.user_id = u.id and m.workspace_id = (select id from public.workspaces where is_legacy)');
end $$;
grant usage on schema crm_auth_private to crm_workspace_server;
grant execute on function crm_auth_private.read_crm_session(uuid,uuid) to crm_workspace_server;

revoke all on function public.read_workspace_session(uuid,uuid,uuid),public.create_crm_workspace(uuid,text,text),public.accept_workspace_invitation(uuid,text) from public,anon,authenticated,crm_workspace_server;
grant execute on function public.read_workspace_session(uuid,uuid,uuid),public.create_crm_workspace(uuid,text,text),public.accept_workspace_invitation(uuid,text) to service_role;

-- Database cron jobs enter the same RLS boundary as HTTP jobs.
alter function public.notify_due_crm_tasks() set schema crm_tenancy;
alter function public.dispatch_erp_inventory_sync() set schema crm_tenancy;
do $$ declare d text; begin
  select pg_get_functiondef('crm_tenancy.dispatch_erp_inventory_sync()'::regprocedure) into d;
  d:=replace(d,'url := v_settings.worker_url','url := v_settings.worker_url || ''?workspace='' || crm_tenancy.workspace_id()::text');
  -- This private capability performs one stored, workspace-bound dispatch. The
  -- tenant role never receives general outbound HTTP or Vault privileges.
  d:=replace(d,'where singleton','where workspace_id=nullif(current_setting(''crm.workspace_id'',true),'''')::uuid and singleton');
  execute d;
end $$;
alter function crm_tenancy.dispatch_erp_inventory_sync() security definer;
revoke all on function crm_tenancy.dispatch_erp_inventory_sync() from public,anon,authenticated;
grant execute on function crm_tenancy.notify_due_crm_tasks(),crm_tenancy.dispatch_erp_inventory_sync() to crm_workspace_server;
create function public.notify_due_crm_tasks() returns integer language plpgsql security invoker set search_path='' as $$
declare tenant record; caller text:=current_user; total integer:=0;
begin
  if current_user='crm_workspace_server' then return crm_tenancy.notify_due_crm_tasks(); end if;
  for tenant in select id from public.workspaces loop
    perform set_config('crm.workspace_id',tenant.id::text,true);
    perform set_config('role','crm_workspace_server',true);
    total:=total+crm_tenancy.notify_due_crm_tasks();
    perform set_config('role',caller,true);
  end loop;
  return total;
end $$;
create function public.dispatch_erp_inventory_sync() returns bigint language plpgsql security invoker set search_path='' as $$
declare tenant record; caller text:=current_user; dispatched bigint;
begin
  if current_user='crm_workspace_server' then return crm_tenancy.dispatch_erp_inventory_sync(); end if;
  for tenant in select id from public.workspaces loop
    perform set_config('crm.workspace_id',tenant.id::text,true);
    perform set_config('role','crm_workspace_server',true);
    dispatched:=crm_tenancy.dispatch_erp_inventory_sync();
    perform set_config('role',caller,true);
  end loop;
  return dispatched;
end $$;
revoke all on function public.notify_due_crm_tasks(),public.dispatch_erp_inventory_sync() from public,anon,authenticated;
grant execute on function public.notify_due_crm_tasks(),public.dispatch_erp_inventory_sync() to service_role,crm_workspace_server;
notify pgrst,'reload config';
notify pgrst,'reload schema';
do $$ declare r record; n bigint; legacy uuid; begin
  select id into legacy from public.workspaces where is_legacy;
  for r in select * from rollout_row_counts loop
    execute format('select count(*) from public.%I where workspace_id=$1',r.name) into n using legacy;
    if n<>r.expected then raise exception 'Existing row count changed for %',r.name; end if;
  end loop;
end $$;
commit;
