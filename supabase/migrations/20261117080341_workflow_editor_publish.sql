begin;
alter table public.flow_editor_drafts add column publication_error text;
create function public.publish_flow_editor_draft(p_user_id uuid,p_flow_id uuid,p_revision bigint,p_input jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare f public.flows; d public.flow_editor_drafts;
begin
  select * into f from public.flows where id=p_flow_id and user_id=p_user_id and workspace_id=crm_tenancy.workspace_id() for update;
  if not found then raise exception 'Workflow not found'; end if;
  select * into d from public.flow_editor_drafts where workspace_id=f.workspace_id and flow_id=f.id;
  if d.flow_id is null or d.revision<>p_revision or d.base_updated_at<>f.updated_at then
    raise exception using errcode='40001',message='Workflow changed. Reload before saving.';
  end if;
  if p_input->>'status'<>f.status then raise exception 'Autosave cannot change workflow status'; end if;
  return public.save_automation_flow(p_user_id,p_flow_id,p_input);
end $$;
revoke all on function public.publish_flow_editor_draft(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.publish_flow_editor_draft(uuid,uuid,bigint,jsonb) to crm_workspace_server,service_role;
notify pgrst,'reload schema';
commit;
