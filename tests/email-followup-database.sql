-- Rollback-only verification. No customer emails or permanent tasks are created.
begin;
do $$
declare v_workspace uuid; v_user uuid; v_other uuid; v_id uuid:=gen_random_uuid(); v_task uuid; v_count int; v_due timestamptz:=now()+interval '1 day';
begin
  v_workspace:=crm_tenancy.workspace_id();
  select user_id into strict v_user from public.workspace_members where workspace_id=v_workspace and activated_at is not null and role='admin' limit 1;
  insert into public.email_message_followups(id,workspace_id,user_id,mailbox_id,message_key,message_id,thread_key,conversation_url,recipient,anchors,baseline,context_at,kind,due_at,subject)
    values(v_id,v_workspace,v_user,'verification-mailbox','verification-'||v_id,'<verification@example.invalid>','verification-'||v_id,'/email?mailbox=verification','verification@example.invalid',array['<verification@example.invalid>'],array['<verification@example.invalid>'],now(),'reminder',v_due,'Follow-up verification');
  select task_id into strict v_task from public.email_message_followups where id=v_id;
  assert v_task is not null,'Reminder must create a task atomically';
  select count(*) into v_count from public.crm_tasks where id=v_task and assigned_to=v_user and due_at=v_due and status='open';
  assert v_count=1,'Task assignee and due date must match';
  select count(*) into v_count from public.email_inbox_state where workspace_id=v_workspace and user_id=v_user and message_key='verification-'||v_id and follow_up_at=v_due;
  assert v_count=1,'Reminder must appear in Needs follow-up';
  update public.email_message_followups set due_at=v_due+interval '1 day',revision=revision+1 where id=v_id and revision=1 and status='scheduled';
  select count(*) into v_count from public.crm_tasks where id=v_task and due_at=v_due+interval '1 day' and status='open';
  assert v_count=1,'Rescheduling must update the same task';
  update public.email_message_followups set status='cancelled',revision=revision+1 where id=v_id and revision=1;
  get diagnostics v_count=row_count;
  assert v_count=0,'Stale revision cannot cancel a changed follow-up';
  update public.email_message_followups set status='cancelled',revision=revision+1 where id=v_id and revision=2;
  select count(*) into v_count from public.crm_tasks where id=v_task and status='cancelled';
  assert v_count=1,'Cancellation must retire the task';
  select count(*) into v_count from public.email_inbox_state where workspace_id=v_workspace and user_id=v_user and message_key='verification-'||v_id and follow_up_at is null;
  assert v_count=1,'Cancellation must clear its inbox marker';
  v_count:=0;
  begin
    update public.email_message_followups set purpose='nurture' where id=v_id;
  exception when check_violation then v_count:=1;
  end;
  assert v_count=1,'Manual reminders cannot enroll customers in AI nurture';
  update public.email_message_followups set kind='ai',purpose='nurture',body='Disposable verification',revision=revision+1 where id=v_id;
  assert (select purpose='nurture' from public.email_message_followups where id=v_id),'AI nurture enrollment must be durable';
  assert not has_table_privilege('authenticated','public.email_message_followups','SELECT'),'Browser roles cannot read follow-ups directly';
  assert not has_function_privilege('authenticated','public.sync_email_message_followup()','EXECUTE'),'Browser roles cannot run task synchronization';
  select user_id into v_other from public.workspace_members where workspace_id=v_workspace and user_id<>v_user limit 1;
  if v_other is not null then
    update public.email_message_followups set kind='ai',body='Disposable verification',status='scheduled',revision=revision+1 where id=v_id;
    v_count:=0;
    begin
      insert into public.email_message_followups(id,workspace_id,user_id,mailbox_id,message_key,message_id,thread_key,conversation_url,recipient,anchors,baseline,context_at,kind,due_at,subject,body)
        values(gen_random_uuid(),v_workspace,v_other,'verification-mailbox','other-verification-'||v_id,'<verification@example.invalid>','verification-'||v_id,'/email?mailbox=verification','verification@example.invalid',array['<verification@example.invalid>'],array['<verification@example.invalid>'],now(),'ai',v_due,'Follow-up verification','Disposable verification');
    exception when unique_violation then v_count:=1;
    end;
    assert v_count=1,'Teammates cannot queue two AI follow-ups on the same shared conversation';
  end if;
end;
$$;
select 'Reminder lifecycle, revision fencing, inbox markers, browser restrictions and shared-conversation delivery exclusion passed' as result;
rollback;
