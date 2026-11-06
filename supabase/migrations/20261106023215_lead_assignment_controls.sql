begin;

create table public.lead_assignment_settings (
  id boolean primary key default true check(id),
  enabled boolean not null default true,
  strategy text not null default 'lowest_workload' check(strategy in ('lowest_workload','round_robin')),
  workload text not null default 'all' check(workload in ('all','open')),
  capacities jsonb not null default '{}'::jsonb check(jsonb_typeof(capacities)='object'),
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.lead_assignment_settings enable row level security;
revoke all on public.lead_assignment_settings from public,anon,authenticated;
grant select,insert,update on public.lead_assignment_settings to service_role;

-- Also support installations where the pending tenancy upgrade has been applied.
-- When applied before tenancy, that upgrade automatically scopes this table.
do $$ begin
  if to_regclass('public.workspaces') is not null then
    alter table public.lead_assignment_settings add column workspace_id uuid not null default crm_tenancy.workspace_id() references public.workspaces(id);
    alter table public.lead_assignment_settings drop constraint lead_assignment_settings_pkey;
    alter table public.lead_assignment_settings add primary key(workspace_id,id);
    create policy crm_workspace_isolation on public.lead_assignment_settings to crm_workspace_server
      using(workspace_id=(select crm_tenancy.workspace_id())) with check(workspace_id=(select crm_tenancy.workspace_id()));
    grant select,insert,update on public.lead_assignment_settings to crm_workspace_server;
  end if;
end $$;

-- Pool changes must never bypass pause/capacity or silently drain the queue.
drop trigger if exists workspace_members_assign_unowned_to_sole_bd_insert on public.workspace_members;
drop trigger if exists workspace_members_assign_unowned_to_sole_bd_update on public.workspace_members;
drop trigger if exists workspace_members_assign_unowned_to_sole_bd_delete on public.workspace_members;
drop trigger if exists workspace_members_assign_unowned_to_sole_bd on public.workspace_members;

create or replace function public.claim_next_bd_sales_manager() returns uuid
language plpgsql security invoker set search_path='' as $$
declare
  selected_user_id uuid;
  policy public.lead_assignment_settings%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('filazoo_bd_lead_assignment'));
  select * into policy from public.lead_assignment_settings where id;
  if policy.enabled is false then return null; end if;
  select member.user_id into selected_user_id
  from public.workspace_members member
  cross join lateral (
    select count(*) as total, count(*) filter(where stage not in ('won','lost')) as open
    from public.pipeline where owner_id=member.user_id
  ) load
  where member.role='bd_manager' and member.auto_assign_leads and member.activated_at is not null
    and (policy.capacities->>member.user_id::text is null or
      case when policy.workload='open' then load.open else load.total end < (policy.capacities->>member.user_id::text)::integer)
  order by case when coalesce(policy.strategy,'lowest_workload')='lowest_workload'
    then case when policy.workload='open' then load.open else load.total end else 0 end,
    member.last_lead_assigned_at asc nulls first, member.user_id asc
  limit 1 for update of member;
  if selected_user_id is not null then
    update public.workspace_members set last_lead_assigned_at=clock_timestamp() where user_id=selected_user_id;
  end if;
  return selected_user_id;
end $$;

create function public.read_lead_assignment_settings(p_actor_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare policy public.lead_assignment_settings%rowtype; members jsonb;
begin
  if not exists(select 1 from public.workspace_members where user_id=p_actor_id and role='admin' and activated_at is not null) then raise insufficient_privilege; end if;
  select * into policy from public.lead_assignment_settings where id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId',m.user_id,'name',coalesce(nullif(m.display_name,''),'BD Sales Manager'),
    'enabled',m.auto_assign_leads,'activated',m.activated_at is not null,
    'capacity',(policy.capacities->>m.user_id::text)::integer,'total',load.total,'open',load.open,
    'lastAssignedAt',m.last_lead_assigned_at) order by m.created_at,m.user_id),'[]'::jsonb)
  into members from public.workspace_members m cross join lateral (
    select count(*) as total,count(*) filter(where stage not in ('won','lost')) as open
    from public.pipeline where owner_id=m.user_id
  ) load where m.role='bd_manager';
  return jsonb_build_object('revision',coalesce(policy.revision,0),'enabled',coalesce(policy.enabled,true),
    'strategy',coalesce(policy.strategy,'lowest_workload'),'workload',coalesce(policy.workload,'all'),
    'members',members,'unassigned',(select count(*) from public.pipeline where owner_id is null));
end $$;

create function public.save_lead_assignment_settings(p_actor_id uuid,p_policy jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item jsonb; limits jsonb:='{}'::jsonb; current_revision integer;
begin
  perform pg_advisory_xact_lock(hashtext('filazoo_bd_lead_assignment'));
  if not exists(select 1 from public.workspace_members where user_id=p_actor_id and role='admin' and activated_at is not null) then raise insufficient_privilege; end if;
  if jsonb_typeof(p_policy->'enabled') is distinct from 'boolean' or p_policy->>'strategy' not in ('lowest_workload','round_robin')
    or p_policy->>'workload' not in ('all','open') or jsonb_typeof(p_policy->'members') is distinct from 'array'
    or p_policy->>'revision' is null or p_policy->>'strategy' is null or p_policy->>'workload' is null then raise exception 'Invalid assignment settings'; end if;
  if jsonb_array_length(p_policy->'members') <> (select count(distinct value->>'userId') from jsonb_array_elements(p_policy->'members')) then raise exception 'Duplicate manager'; end if;
  if jsonb_array_length(p_policy->'members') <> (select count(*) from public.workspace_members where role='bd_manager') then raise exception 'Manager pool changed'; end if;
  for item in select value from jsonb_array_elements(p_policy->'members') loop
    if jsonb_typeof(item->'enabled') is distinct from 'boolean' or not exists(
      select 1 from public.workspace_members where user_id=(item->>'userId')::uuid and role='bd_manager'
    ) then raise exception 'Invalid manager'; end if;
    if item->'capacity' is distinct from 'null'::jsonb then
      if jsonb_typeof(item->'capacity') is distinct from 'number' or (item->>'capacity')::numeric not between 1 and 1000000
        or trunc((item->>'capacity')::numeric) <> (item->>'capacity')::numeric then raise exception 'Invalid capacity'; end if;
      limits:=limits || jsonb_build_object(item->>'userId',(item->>'capacity')::integer);
    end if;
  end loop;
  insert into public.lead_assignment_settings(id) select true where not exists(select 1 from public.lead_assignment_settings where id);
  select revision into current_revision from public.lead_assignment_settings where id for update;
  if current_revision <> (p_policy->>'revision')::integer then raise exception 'Lead assignment settings changed'; end if;
  update public.lead_assignment_settings set enabled=(p_policy->>'enabled')::boolean,strategy=p_policy->>'strategy',
    workload=p_policy->>'workload',capacities=limits,revision=revision+1,updated_at=now() where id;
  for item in select value from jsonb_array_elements(p_policy->'members') loop
    update public.workspace_members set auto_assign_leads=(item->>'enabled')::boolean,updated_at=now()
    where user_id=(item->>'userId')::uuid and role='bd_manager';
  end loop;
  insert into public.events(actor_id,type,data) values(p_actor_id,'lead_assignment_settings_changed',
    jsonb_build_object('summary','Lead assignment rules updated.','policy',p_policy));
  return public.read_lead_assignment_settings(p_actor_id);
end $$;

-- Persist ownership in the same transaction as selection so simultaneous imports
-- cannot all claim the final capacity slot. Existing owners always take priority.
create function public.assign_incoming_company(p_company_id uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare owner uuid;
begin
  perform 1 from public.companies where id=p_company_id for update;
  if not found then raise exception 'Company not found'; end if;
  perform pg_advisory_xact_lock(hashtext('filazoo_bd_lead_assignment'));
  select owner_id into owner from public.pipeline where company_id=p_company_id for update;
  if owner is not null then return owner; end if;
  owner:=public.claim_next_bd_sales_manager();
  update public.pipeline set owner_id=owner,updated_at=now() where company_id=p_company_id;
  if not found then insert into public.pipeline(company_id,owner_id) values(p_company_id,owner); end if;
  return owner;
end $$;

-- Automatic participation is independent of an administrator's manual override.
do $$ declare definition text; begin
  select pg_get_functiondef('public.assign_company_owner(uuid,uuid,uuid)'::regprocedure) into definition;
  execute replace(definition,'and auto_assign_leads = true and activated_at is not null','and activated_at is not null');
end $$;

revoke all on function public.claim_next_bd_sales_manager(), public.read_lead_assignment_settings(uuid),
  public.save_lead_assignment_settings(uuid,jsonb), public.assign_incoming_company(uuid) from public,anon,authenticated;
grant execute on function public.claim_next_bd_sales_manager(), public.read_lead_assignment_settings(uuid),
  public.save_lead_assignment_settings(uuid,jsonb), public.assign_incoming_company(uuid) to service_role;
do $$ begin
  if exists(select 1 from pg_roles where rolname='crm_workspace_server') then
    grant execute on function public.claim_next_bd_sales_manager(), public.read_lead_assignment_settings(uuid),
      public.save_lead_assignment_settings(uuid,jsonb), public.assign_incoming_company(uuid) to crm_workspace_server;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
