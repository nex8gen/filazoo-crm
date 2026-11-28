begin;
set local lock_timeout = '5s';

alter table public.workspaces
  add column website text not null default '' check (length(website) <= 500 and (website = '' or website ~ '^https?://[^[:space:]]+$')),
  add column logo_data_url text check (length(logo_data_url) <= 200000 and logo_data_url ~ '^data:image/webp;base64,[A-Za-z0-9+/=]+$'),
  add column timezone text not null default 'Asia/Shanghai',
  add column business_hours jsonb not null default '{"days":[1,2,3,4,5],"start":"09:00","end":"17:00"}'::jsonb;

create function crm_tenancy.validate_workspace_schedule() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare hours jsonb := new.business_hours;
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Invalid workspace timezone';
  end if;
  if jsonb_typeof(hours) is distinct from 'object'
    or jsonb_typeof(hours->'days') is distinct from 'array'
    or not (hours ?& array['days','start','end'])
    or jsonb_typeof(hours->'start') is distinct from 'string'
    or jsonb_typeof(hours->'end') is distinct from 'string' then
    raise exception 'Invalid workspace business hours';
  end if;
  if jsonb_array_length(hours->'days') not between 1 and 7
    or exists(select 1 from jsonb_array_elements(hours->'days') d where jsonb_typeof(d) <> 'number' or d::text !~ '^[0-6]$')
    or (hours->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or (hours->>'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or (hours->>'start') >= (hours->>'end') then
    raise exception 'Invalid workspace business hours';
  end if;
  return new;
end $$;
revoke all on function crm_tenancy.validate_workspace_schedule() from public, anon, authenticated;
create trigger validate_workspace_schedule before insert or update of timezone,business_hours on public.workspaces
for each row execute function crm_tenancy.validate_workspace_schedule();

create table public.workspace_activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid,
  actor_name text,
  area text not null,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  target_label text,
  changed_fields text[] not null,
  created_at timestamptz not null default now()
);
create index workspace_activity_recent on public.workspace_activity(workspace_id,created_at desc,id desc);
alter table public.workspace_activity enable row level security;
revoke all on public.workspace_activity from public,anon,authenticated,crm_workspace_server;
grant select,insert on public.workspace_activity to service_role,crm_workspace_server;
create policy workspace_activity_insert on public.workspace_activity for insert to crm_workspace_server
with check (workspace_id = (select crm_tenancy.workspace_id()));
create policy workspace_activity_admin_read on public.workspace_activity for select to crm_workspace_server
using (workspace_id = (select crm_tenancy.workspace_id()) and exists (
  select 1 from public.workspace_members m where m.workspace_id = workspace_activity.workspace_id
    and m.user_id = nullif(current_setting('request.headers',true)::jsonb->>'x-crm-user-id','')::uuid
    and m.role = 'admin' and m.activated_at is not null
));

-- Record only the names of explicitly approved fields. Never copy credentials,
-- tokens, policies, message bodies or images into the activity log.
create function crm_tenancy.log_workspace_activity() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  before_row jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  after_row jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  row_data jsonb;
  tenant uuid;
  actor uuid;
  actor_label text;
  fields text[];
  target text;
begin
  row_data := case when tg_op = 'DELETE' then before_row else after_row end;
  tenant := case when tg_table_name = 'workspaces' then (row_data->>'id')::uuid else (row_data->>'workspace_id')::uuid end;
  select array_agg(field order by field) into fields from unnest(string_to_array(tg_argv[0],',')) field
    where tg_op <> 'UPDATE' or (before_row->field) is distinct from (after_row->field);
  if fields is null then return null; end if;
  actor := coalesce(nullif(current_setting('request.headers',true)::jsonb->>'x-crm-user-id','')::uuid,
    nullif(after_row->>'updated_by','')::uuid);
  select coalesce(nullif(display_name,''),'Team member') into actor_label from public.workspace_members
    where workspace_id = tenant and user_id = actor;
  target := case tg_table_name
    when 'workspaces' then row_data->>'name'
    when 'workspace_members' then coalesce(nullif(row_data->>'display_name',''),row_data->>'user_id')
    when 'workspace_invitations' then row_data->>'email'
    when 'workspace_mailboxes' then row_data->>'email'
    when 'erp_connection_settings' then row_data->>'name'
    else null end;
  insert into public.workspace_activity(workspace_id,actor_id,actor_name,area,operation,target_label,changed_fields)
    values(tenant,actor,actor_label,tg_table_name,tg_op,left(target,200),fields);
  return null;
end $$;
revoke all on function crm_tenancy.log_workspace_activity() from public,anon,authenticated;

create trigger workspace_details_activity after update on public.workspaces for each row
execute function crm_tenancy.log_workspace_activity('name,website,logo_data_url,timezone,business_hours,owner_id');
create trigger workspace_members_activity after insert or update or delete on public.workspace_members for each row
execute function crm_tenancy.log_workspace_activity('role,activated_at,auto_assign_leads,display_name');
create trigger workspace_invitations_activity after insert or update or delete on public.workspace_invitations for each row
execute function crm_tenancy.log_workspace_activity('role,accepted_at,revoked_at');
create trigger workspace_mailboxes_activity after insert or update or delete on public.workspace_mailboxes for each row
execute function crm_tenancy.log_workspace_activity('email,display_name,provider,is_default,is_active,smtp_host,smtp_port,smtp_username,smtp_password,imap_host,imap_port,imap_username,imap_password,sync_preferences');
create trigger workspace_erp_activity after insert or update or delete on public.erp_connection_settings for each row
execute function crm_tenancy.log_workspace_activity('provider,name,app_id,app_secret_id,worker_secret_id,warehouse_ids,sku_map,enabled,sync_interval,worker_url');
create trigger workspace_ai_activity after insert or update on public.workspace_ai_settings for each row
execute function crm_tenancy.log_workspace_activity('policy');
create trigger workspace_budget_activity after insert or update on public.ai_budget_policy for each row
execute function crm_tenancy.log_workspace_activity('monthly_micros,daily_micros,member_limits,credit_only');
create trigger workspace_assignment_activity after insert or update on public.lead_assignment_settings for each row
execute function crm_tenancy.log_workspace_activity('enabled,strategy,workload,capacities');

notify pgrst,'reload schema';
commit;
