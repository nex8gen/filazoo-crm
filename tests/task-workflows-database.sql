-- Transactional synthetic fixtures only. No email, network call, or lasting record.
begin;
do $$
#variable_conflict use_variable
declare actor uuid; mailbox uuid; customer uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid(); other uuid:=gen_random_uuid();
  recipient text; sent_id text:='<qa-task-database-sent@filazoo.invalid>'; r integer; n integer; accepted boolean; v jsonb;
begin
  select user_id into actor from public.workspace_members where role='admin' and activated_at is not null limit 1;
  select id,email into mailbox,recipient from public.workspace_mailboxes where type='workspace' and is_active and is_default limit 1;
  if actor is null or mailbox is null then raise exception 'An active admin and owned workspace mailbox are required'; end if;
  recipient := 'task-rollback-'||gen_random_uuid()::text||'@example.invalid';
  insert into public.companies(id,name,source) values(customer,'[QA rollback] Actionable task contracts','internal_qa');
  insert into public.contacts(company_id,name,email) values(customer,'Synthetic database fixture',recipient);
  insert into public.agent_reply_requests(id,user_id,owner_role,company_id,company_name,mailbox_id,recipient,subject,body,needed,task_title,task_notes,scope_key,status,message_id,waiting_since,expires_at,on_reply)
    values(request_id,actor,'admin',customer,'QA rollback',mailbox,recipient,'Synthetic request','No email is sent.',array['shipping_address'],'Review synthetic invoice','Synthetic database test only.',request_id::text,'waiting',sent_id,now()-interval '1 minute',now()+interval '1 day','{"kind":"invoice_review"}');
  v:=jsonb_build_object('sender','outsider@example.invalid','automaticResponse',false,'messageId','<qa-reply@filazoo.invalid>','timestamp',now(),'inReplyTo',sent_id,'references',jsonb_build_array(sent_id),'text','99 Synthetic Test Road');
  select public.finish_agent_reply_request(request_id,actor,1,'received',v,'Synthetic context only.',null) into accepted;
  if accepted then raise exception 'An unrelated sender completed a wait'; end if;
  v:=v||jsonb_build_object('sender',recipient);
  select public.finish_agent_reply_request(request_id,actor,1,'received',v,'Synthetic context only.',null) into accepted;
  if not accepted then raise exception 'The matching reply did not create its task'; end if;
  select count(*) into n from public.crm_task_workflows where task_id=request_id and kind='invoice_review' and status='preparing';
  if n<>1 then raise exception 'Exactly one workflow must be seeded atomically'; end if;
  select public.finish_agent_reply_request(request_id,actor,1,'received',v,'Duplicate',null) into accepted;
  if accepted then raise exception 'A stale reply was applied twice'; end if;
  select count(*) into n from public.internal_notifications where task_id=request_id;
  if n<>1 then raise exception 'Duplicate task notification'; end if;
  select count(*) into n from public.claim_task_workflow(request_id);
  if n<>1 then raise exception 'Preparation was not claimed'; end if;
  select count(*) into n from public.claim_task_workflow(request_id);
  if n<>0 then raise exception 'Two workers claimed the same preparation'; end if;
  select revision into r from public.crm_task_workflows where task_id=request_id;
  update public.crm_task_workflows set status='ready',lease_until=null,revision=revision+1,payload='{"profileBaseline":{}}' where task_id=request_id;
  r:=r+1;
  select public.finish_task_workflow(request_id,other,r,'{}') into accepted;
  if accepted then raise exception 'A nonmember completed a workflow'; end if;
  select public.finish_task_workflow(request_id,actor,r,'{}') into accepted;
  if accepted then raise exception 'Invoice work completed without a real delivery reservation'; end if;
  begin
    update public.crm_tasks set status='done' where id=request_id;
    raise exception 'Generic completion bypassed the workflow';
  exception when raise_exception then
    if sqlerrm='Generic completion bypassed the workflow' then raise; end if;
  end;
  update public.crm_task_workflows set kind='customer_details',payload=jsonb_build_object('profileBaseline',jsonb_build_object('shippingAddress','')) where task_id=request_id;
  insert into public.customer_billing_profiles(company_id,profile) values(customer,'{"address":"Keep billing office","phone":"Keep phone"}');
  select public.apply_task_workflow_details(request_id,actor,r,'{"shippingAddress":"99 Synthetic Test Road"}') into accepted;
  if not accepted then raise exception 'Reviewed customer details were not applied'; end if;
  select profile into v from public.customer_billing_profiles where company_id=customer;
  if v->>'address'<>'Keep billing office' or v->>'phone'<>'Keep phone' or v->>'shippingAddress'<>'99 Synthetic Test Road' then raise exception 'Unrelated billing fields were overwritten'; end if;
  select public.apply_task_workflow_details(request_id,actor,r,'{"shippingAddress":"Stale overwrite"}') into accepted;
  if accepted then raise exception 'A stale profile action was accepted'; end if;
  select revision into r from public.crm_task_workflows where task_id=request_id;
  select public.finish_task_workflow(request_id,actor,r+1,'{}') into accepted;
  if accepted then raise exception 'A stale task action was accepted'; end if;
  select public.finish_task_workflow(request_id,actor,r,jsonb_build_object('detailsApplied',true)) into accepted;
  if not accepted then raise exception 'Reviewed details could not finish'; end if;
  if not exists(select 1 from public.crm_tasks where id=request_id and status='done' and completed_at is not null) then raise exception 'Workflow completion did not complete its task'; end if;
  if exists(select 1 from public.internal_notifications where task_id=request_id and read_at is null) then raise exception 'Completed task still has unread notifications'; end if;
  select count(*) into n from public.crm_task_workflow_events where task_id=request_id;
  if n<4 then raise exception 'Workflow audit events are missing'; end if;
  -- Rolling deployment: only an untouched legacy plain review can use the old
  -- generic completion button. Explicit workflows retain the action guard.
  update public.crm_tasks set status='open' where id=request_id;
  update public.crm_task_workflows set kind='reply_review',status='preparing',lease_until=null,payload='{}' where task_id=request_id;
  begin
    update public.crm_tasks set status='done' where id=request_id;
    raise exception 'Explicit work bypassed its action during rollout';
  exception when raise_exception then
    if sqlerrm='Explicit work bypassed its action during rollout' then raise; end if;
  end;
  update public.agent_reply_requests set on_reply=null where id=request_id;
  for v in select * from jsonb_array_elements('[{"payload":{"preparedAt":"2026-10-30T00:00:00Z"}},{"payload":{"deliveryId":"a1111111-1111-4111-8111-111111111111"}},{"leased":true},{"status":"ready"},{"status":"sending"},{"status":"uncertain"}]'::jsonb) loop
    update public.crm_task_workflows set status=coalesce(v->>'status','preparing'),
      payload=coalesce(v->'payload','{}'::jsonb),lease_until=case when v->>'leased'='true' then now()+interval '1 minute' else null end where task_id=request_id;
    begin
      update public.crm_tasks set status='done' where id=request_id;
      raise exception 'Prepared, leased or attempted legacy work bypassed its action';
    exception when raise_exception then
      if sqlerrm='Prepared, leased or attempted legacy work bypassed its action' then raise; end if;
    end;
  end loop;
  update public.crm_task_workflows set status='preparing',payload='{}',lease_until=null where task_id=request_id;
  update public.crm_tasks set status='done' where id=request_id;
  if not exists(select 1 from public.crm_task_workflows where task_id=request_id and status='done') then raise exception 'Legacy review completion was not recorded'; end if;
end $$;
rollback;
select 'PASS: atomic reply handoff, deduplicated notifications, exclusive preparation, stale-action guards, membership, profile merge, completion, audit and narrow legacy compatibility. All fixtures rolled back.' as result;
