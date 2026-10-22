begin;

-- Only the authenticated application server can invoke this transactional save.
create or replace function public.save_automation_flow(p_user_id uuid, p_flow_id uuid, p_input jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  saved_id uuid;
  definition jsonb;
begin
  if p_flow_id is null then
    insert into public.flows(user_id,created_by,name,trigger_type,trigger_config,status)
    values(p_user_id,p_user_id,p_input->>'name',p_input->>'triggerType',p_input->'triggerConfig','draft')
    returning id into saved_id;
  else
    select id into saved_id from public.flows where id=p_flow_id and user_id=p_user_id for update;
    if saved_id is null then raise exception 'Flow not found.'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'position',position,'type',type,'config',config) order by position),'[]'::jsonb)
      into definition from public.flow_steps where flow_id=saved_id;
    update public.flow_runs set context=context || jsonb_build_object('definition',definition::text)
      where flow_id=saved_id and status='active' and not (context ? 'definition');
    delete from public.flow_steps where flow_id=saved_id;
  end if;
  insert into public.flow_steps(flow_id,position,type,config)
    select saved_id,(ordinality-1)::integer,step->>'type',step->'config'
    from jsonb_array_elements(p_input->'steps') with ordinality as items(step,ordinality);
  if not exists(select 1 from public.flow_steps where flow_id=saved_id) then
    raise exception 'Add at least one step.';
  end if;
  update public.flows set name=p_input->>'name',trigger_type=p_input->>'triggerType',
    trigger_config=p_input->'triggerConfig',status=p_input->>'status',updated_at=now() where id=saved_id;
  return saved_id;
end;
$$;
revoke all on function public.save_automation_flow(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_automation_flow(uuid,uuid,jsonb) to service_role;

create index if not exists flow_run_logs_engagement_idx on public.flow_run_logs(run_id,created_at) where result->>'action' in ('email_opened','link_clicked');
create index if not exists emails_message_id_idx on public.emails(message_id);
notify pgrst, 'reload schema';
commit;
