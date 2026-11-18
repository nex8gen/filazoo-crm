begin;
do $$
declare f public.flows; target uuid:='f18a0000-0000-4000-8000-000000000001'; payload jsonb; v integer;
begin
  select * into f from public.flows order by created_at limit 1;
  if not found then raise exception 'A workspace flow is required for this test'; end if;
  perform set_config('crm.workspace_id',f.workspace_id::text,true);
  perform set_config('request.headers',jsonb_build_object('x-crm-user-id',f.user_id)::text,true);
  insert into public.flows(id,workspace_id,user_id,created_by,name,trigger_type,trigger_config,status)
    values(target,f.workspace_id,f.user_id,f.user_id,'History verification',f.trigger_type,'{}','draft');
  insert into public.flow_steps(workspace_id,flow_id,position,type,config) values(f.workspace_id,target,0,'wait','{"amount":1,"unit":"days"}');
  update public.flows set updated_at=now() where id=target;
  set constraints all immediate;
  if (select count(*) from public.flow_change_history where flow_id=target) <> 1 then raise exception 'Creation should produce one version'; end if;
  if not exists(select 1 from public.flow_change_history where flow_id=target and actor_id=f.user_id and jsonb_array_length(definition->'steps')=1) then raise exception 'Actor or final steps missing'; end if;
  set constraints all deferred;
  update public.flows set updated_at=clock_timestamp() where id=target;
  set constraints all immediate;
  if (select count(*) from public.flow_change_history where flow_id=target) <> 1 then raise exception 'No-op saves must not produce versions'; end if;
  set constraints all deferred;
  update public.flows set name='Renamed history verification',status='paused' where id=target;
  set constraints all immediate;
  if not exists(select 1 from public.flow_change_history where flow_id=target and version=2 and changes @> '[{"kind":"name"},{"kind":"status"}]') then raise exception 'Rename/status changes missing'; end if;
  select definition || '{"steps":[{"id":"draft-action","type":"send_email","config":{}}]}'::jsonb into payload from public.flow_change_history where flow_id=target and version=2;
  set constraints all deferred;
  insert into public.flow_editor_drafts(workspace_id,flow_id,payload,revision,base_updated_at)
    select f.workspace_id,target,payload,1,updated_at from public.flows where id=target;
  set constraints all immediate;
  if not exists(select 1 from public.flow_change_history where flow_id=target and version=3 and changes @> '[{"kind":"actions"}]') then raise exception 'Incomplete editing changes missing'; end if;
  set constraints all deferred;
  -- Publishing the same editing copy must not add a duplicate version.
  delete from public.flow_steps where flow_id=target;
  insert into public.flow_steps(workspace_id,flow_id,position,type,config) values(f.workspace_id,target,0,'send_email','{}');
  update public.flows set updated_at=clock_timestamp() where id=target;
  set constraints all immediate;
  select max(version) into v from public.flow_change_history where flow_id=target;
  if v<>3 then raise exception 'Publishing a recorded draft duplicated its version'; end if;
  perform set_config('crm.workspace_id','f18a0000-0000-4000-8000-000000000002',true);
end $$;
set local role crm_workspace_server;
do $$ begin
  if exists(select 1 from public.flow_change_history where flow_id='f18a0000-0000-4000-8000-000000000001') then raise exception 'History leaked across workspaces'; end if;
  if has_table_privilege('anon','public.flow_change_history','SELECT') or has_table_privilege('authenticated','public.flow_change_history','SELECT') then raise exception 'Public history access must be revoked'; end if;
end $$;
reset role;
rollback;
select 'Flow history recording, deduplication, drafts, actors, and tenant isolation passed' as result;
