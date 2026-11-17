begin;
create table public.flow_editor_drafts (
  flow_id uuid not null,
  workspace_id uuid not null default crm_tenancy.workspace_id() references public.workspaces(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 1000000),
  revision bigint not null check (revision > 0),
  base_updated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key(workspace_id,flow_id),
  foreign key(workspace_id,flow_id) references public.flows(workspace_id,id) on delete cascade
);
alter table public.flow_editor_drafts enable row level security;
revoke all on public.flow_editor_drafts from public,anon,authenticated;
grant select,insert,update,delete on public.flow_editor_drafts to crm_workspace_server,service_role;
create policy flow_editor_workspace on public.flow_editor_drafts to crm_workspace_server
  using (workspace_id = (select crm_tenancy.workspace_id()))
  with check (workspace_id = (select crm_tenancy.workspace_id()));

-- The editor copy is never read by enrollment or action execution.
-- Lock the parent so publishing and autosaving cannot race each other.
create function public.save_flow_editor_draft(p_user_id uuid,p_flow_id uuid,p_create boolean,p_revision bigint,p_base_updated_at timestamptz,p_input jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare f public.flows; d public.flow_editor_drafts; payload jsonb;
begin
  if p_revision < 0 or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>750000 then raise exception 'Invalid workflow editing copy'; end if;
  if p_create then
    insert into public.flows(id,user_id,created_by,name,trigger_type,trigger_config,status)
    values(p_flow_id,p_user_id,p_user_id,coalesce(nullif(trim(p_input->>'name'),''),'Untitled workflow'),p_input->>'triggerType',p_input->'triggerConfig','draft')
    on conflict(workspace_id,id) do nothing;
  end if;
  select * into f from public.flows where id=p_flow_id and user_id=p_user_id and workspace_id=crm_tenancy.workspace_id() for update;
  if not found then raise exception 'Workflow not found'; end if;
  if p_create and (f.status<>'draft' or exists(select 1 from public.flow_steps where flow_id=f.id and workspace_id=f.workspace_id)) then raise exception using errcode='40001',message='Workflow changed. Reload before saving.'; end if;
  payload:=p_input || jsonb_build_object('status',f.status);
  select * into d from public.flow_editor_drafts where flow_id=f.id and workspace_id=f.workspace_id;
  if found and d.revision=p_revision+1 and d.payload=payload and d.base_updated_at=f.updated_at then return f.id; end if;
  if (d.flow_id is null and p_revision<>0) or (d.flow_id is not null and d.revision<>p_revision)
     or (not p_create and p_base_updated_at is distinct from f.updated_at) then
    raise exception using errcode='40001',message='Workflow changed. Reload before saving.';
  end if;
  insert into public.flow_editor_drafts(flow_id,workspace_id,payload,revision,base_updated_at)
  values(f.id,f.workspace_id,payload,p_revision+1,f.updated_at)
  on conflict(workspace_id,flow_id) do update set payload=excluded.payload,revision=excluded.revision,base_updated_at=excluded.base_updated_at,updated_at=now();
  return f.id;
end $$;
revoke all on function public.save_flow_editor_draft(uuid,uuid,boolean,bigint,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.save_flow_editor_draft(uuid,uuid,boolean,bigint,timestamptz,jsonb) to crm_workspace_server,service_role;

-- A completed definition is published by the existing atomic save RPC.
-- Remove its editing copy in that same transaction, preventing resurrection by a late request.
create function public.clear_published_flow_editor_draft() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  delete from public.flow_editor_drafts where flow_id=new.id and workspace_id=new.workspace_id;
  return new;
end $$;
revoke all on function public.clear_published_flow_editor_draft() from public,anon,authenticated;
grant execute on function public.clear_published_flow_editor_draft() to crm_workspace_server,service_role;
create trigger flows_clear_editor_draft after update on public.flows for each row execute function public.clear_published_flow_editor_draft();
notify pgrst,'reload schema';
commit;
