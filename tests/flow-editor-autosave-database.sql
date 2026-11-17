begin;
do $$
declare w uuid; u uuid; f uuid:=gen_random_uuid(); base timestamptz; input jsonb; rev bigint; conflicted boolean:=false;
begin
  select id into w from public.workspaces where is_legacy limit 1;
  select user_id into u from public.workspace_members where workspace_id=w and activated_at is not null limit 1;
  if u is null then raise exception 'No test workspace member'; end if;
  perform set_config('crm.workspace_id',w::text,true);
  perform set_config('role','crm_workspace_server',true);
  input:=jsonb_build_object('name','Autosave rollback test','status','live','triggerType','new_lead','triggerConfig','{}'::jsonb,
    'steps',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'type','send_email','config',jsonb_build_object('templateId',''))));
  perform public.save_flow_editor_draft(u,f,true,0,null,input);
  assert (select status='draft' from public.flows where workspace_id=w and id=f),'New autosaves cannot activate a workflow';
  assert not exists(select 1 from public.flow_steps where workspace_id=w and flow_id=f),'Incomplete actions cannot become executable steps';
  select updated_at into base from public.flows where workspace_id=w and id=f;
  perform public.save_flow_editor_draft(u,f,true,0,null,input);
  assert (select revision=1 from public.flow_editor_drafts where workspace_id=w and flow_id=f),'An identical retry must be idempotent';
  input:=jsonb_set(input,'{name}','"Second edit"'::jsonb);
  perform public.save_flow_editor_draft(u,f,false,1,base,input);
  assert (select revision=2 from public.flow_editor_drafts where workspace_id=w and flow_id=f),'Autosave must advance its revision';
  begin
    perform public.save_flow_editor_draft(u,f,false,0,base,input);
  exception when serialization_failure then conflicted:=true; end;
  assert conflicted,'A stale autosave must not overwrite a newer copy';
  update public.flows set status='live' where workspace_id=w and id=f;
  input:=jsonb_set(input,'{steps}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'type','wait','config',jsonb_build_object('amount',1,'unit','days'))));
  select updated_at into base from public.flows where workspace_id=w and id=f;
  perform public.save_flow_editor_draft(u,f,false,0,base,input);
  assert (select status='live' from public.flows where workspace_id=w and id=f),'Saving an editing copy must preserve status';
  assert not exists(select 1 from public.flow_steps where workspace_id=w and flow_id=f),'Editing copies must not affect execution';
  perform public.publish_flow_editor_draft(u,f,1,input);
  assert not exists(select 1 from public.flow_editor_drafts where workspace_id=w and flow_id=f),'Publishing must clear its editing copy atomically';
  assert (select count(*)=1 from public.flow_steps where workspace_id=w and flow_id=f),'A complete autosave must publish through the atomic definition writer';
  conflicted:=false;
  begin
    perform public.save_flow_editor_draft(u,f,false,1,base,input);
  exception when serialization_failure then conflicted:=true; end;
  assert conflicted,'A late autosave must not resurrect a published copy';
  assert not has_function_privilege('authenticated','public.save_flow_editor_draft(uuid,uuid,boolean,bigint,timestamptz,jsonb)','execute'),'Browser roles cannot bypass server authorization';
  assert (select relrowsecurity from pg_class where oid='public.flow_editor_drafts'::regclass),'Editor copies require RLS';
end $$;
rollback;
