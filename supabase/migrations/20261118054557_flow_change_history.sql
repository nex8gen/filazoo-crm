begin;

create table public.flow_change_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default crm_tenancy.workspace_id() references public.workspaces(id) on delete cascade,
  flow_id uuid not null,
  version integer not null,
  actor_id uuid,
  actor_label text not null,
  definition jsonb not null,
  changes jsonb not null,
  summary text not null,
  created_at timestamptz not null default now(),
  unique(workspace_id,flow_id,version),
  foreign key(workspace_id,flow_id) references public.flows(workspace_id,id) on delete cascade
);
create index flow_change_history_latest on public.flow_change_history(workspace_id,flow_id,created_at desc,id desc);
alter table public.flow_change_history enable row level security;
revoke all on public.flow_change_history from public,anon,authenticated;
grant select,insert on public.flow_change_history to crm_workspace_server,service_role;
create policy flow_history_workspace on public.flow_change_history to crm_workspace_server
  using(workspace_id=(select crm_tenancy.workspace_id()))
  with check(workspace_id=(select crm_tenancy.workspace_id()));

-- Read the final definition at commit, after an atomic save has replaced its
-- steps and cleared its editing copy. Repeated row triggers produce one version.
create function public.record_flow_change_history() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
  target uuid; tenant uuid; f public.flows; previous public.flow_change_history;
  payload jsonb; definition jsonb; changes jsonb:='[]'; actor uuid; label text;
  old_steps jsonb; new_steps jsonb; old_step jsonb; new_step jsonb; action_name text; i integer;
begin
  if tg_table_name='flows' then target:=new.id; tenant:=new.workspace_id;
  else target:=new.flow_id; tenant:=new.workspace_id; end if;
  select * into f from public.flows where workspace_id=tenant and id=target for update;
  if not found then return null; end if;
  select d.payload into payload from public.flow_editor_drafts d where d.workspace_id=tenant and d.flow_id=target;
  if payload is null then
    select jsonb_build_object('name',f.name,'status',f.status,'triggerType',f.trigger_type,'triggerConfig',coalesce(f.trigger_config,'{}'),
      'steps',coalesce(jsonb_agg(jsonb_build_object('type',s.type,'config',coalesce(s.config,'{}')) order by s.position) filter(where s.id is not null),'[]'))
      into payload from public.flow_steps s where s.workspace_id=tenant and s.flow_id=target;
  end if;
  select payload || jsonb_build_object('status',f.status,'steps',coalesce(jsonb_agg(step-'id'-'position' order by ord),'[]'))
    into definition from jsonb_array_elements(payload->'steps') with ordinality as steps(step,ord);
  select * into previous from public.flow_change_history where workspace_id=tenant and flow_id=target order by version desc limit 1;
  if previous.definition=definition then return null; end if;
  if previous.id is null then
    changes:=jsonb_build_array(jsonb_build_object('kind','created','description','Created flow ' || f.name));
  else
    if previous.definition->'name' is distinct from definition->'name' then
      changes:=changes || jsonb_build_object('kind','name','description',format('Updated name from %s to %s',previous.definition->>'name',definition->>'name'));
    end if;
    if previous.definition->'status' is distinct from definition->'status' then
      changes:=changes || jsonb_build_object('kind','status','description',format('Updated status from %s to %s',previous.definition->>'status',definition->>'status'));
    end if;
    if previous.definition->'triggerType' is distinct from definition->'triggerType' or previous.definition->'triggerConfig' is distinct from definition->'triggerConfig' then
      changes:=changes || jsonb_build_object('kind','trigger','description','Updated flow trigger and filters');
    end if;
    old_steps:=previous.definition->'steps'; new_steps:=definition->'steps';
    for i in 0..greatest(jsonb_array_length(old_steps),jsonb_array_length(new_steps))-1 loop
      old_step:=old_steps->i; new_step:=new_steps->i;
      if old_step is not distinct from new_step then continue; end if;
      action_name:=replace(coalesce(new_step->>'type',old_step->>'type'),'_',' ');
      changes:=changes || jsonb_build_object('kind','actions','description',
        format('%s %s (step %s)',case when old_step is null then 'Added' when new_step is null then 'Deleted' else 'Updated' end,action_name,i+1));
    end loop;
  end if;
  if changes='[]'::jsonb then return null; end if;
  actor:=nullif(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-crm-user-id','')::uuid;
  select coalesce(nullif(display_name,''),'Workspace member') into label from public.workspace_members where workspace_id=tenant and user_id=actor;
  insert into public.flow_change_history(workspace_id,flow_id,version,actor_id,actor_label,definition,changes,summary)
    values(tenant,target,coalesce(previous.version,0)+1,actor,coalesce(label,'System'),definition,changes,
      (select string_agg(change->>'description',E'\n') from jsonb_array_elements(changes) as items(change)));
  return null;
end $$;
revoke all on function public.record_flow_change_history() from public,anon,authenticated;
grant execute on function public.record_flow_change_history() to crm_workspace_server,service_role;
create constraint trigger flows_change_history after insert or update on public.flows deferrable initially deferred for each row execute function public.record_flow_change_history();
create constraint trigger flow_drafts_change_history after insert or update on public.flow_editor_drafts deferrable initially deferred for each row execute function public.record_flow_change_history();

-- Existing edits cannot be reconstructed. Start with an explicitly labeled
-- baseline, retaining the original creation timestamp only on the flow itself.
insert into public.flow_change_history(workspace_id,flow_id,version,actor_label,definition,changes,summary)
select f.workspace_id,f.id,1,'System',
  jsonb_build_object('name',f.name,'status',f.status,'triggerType',f.trigger_type,'triggerConfig',coalesce(f.trigger_config,'{}'),'steps',
    coalesce((select jsonb_agg(step-'id'-'position' order by ord) from jsonb_array_elements(d.payload->'steps') with ordinality as items(step,ord)),
      (select coalesce(jsonb_agg(jsonb_build_object('type',s.type,'config',coalesce(s.config,'{}')) order by s.position),'[]') from public.flow_steps s where s.workspace_id=f.workspace_id and s.flow_id=f.id)))
    || case when d.payload is not null then d.payload-'steps'-'status' else '{}'::jsonb end,
  '[{"kind":"baseline","description":"Recorded current flow. Earlier changes were not tracked."}]','Recorded current flow. Earlier changes were not tracked.'
from public.flows f left join public.flow_editor_drafts d on d.workspace_id=f.workspace_id and d.flow_id=f.id;
notify pgrst,'reload schema';
commit;
