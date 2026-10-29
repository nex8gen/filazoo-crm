-- Isolated fixtures; no delivery or provider calls. Everything rolls back.
begin;
do $$
declare v_user uuid; v_mailbox uuid; v_auto uuid; v_task uuid; v_key text := '<auto-reply-test-' || gen_random_uuid()::text || '@example.test>';
begin
  select user_id into v_user from public.workspace_members where role='admin' and activated_at is not null limit 1;
  select id into v_mailbox from public.workspace_mailboxes where type='workspace' limit 1;
  if v_user is null or v_mailbox is null then raise exception 'An active admin and workspace mailbox are needed for rollback-only tests'; end if;
  if has_table_privilege('anon','public.email_auto_replies','SELECT') or has_table_privilege('authenticated','public.email_auto_replies','UPDATE')
    or has_table_privilege('authenticated','public.email_auto_reply_deliveries','INSERT') or has_table_privilege('anon','public.email_reply_knowledge','SELECT') then
    raise exception 'Server-only data is exposed';
  end if;
  if has_function_privilege('authenticated','public.handoff_email_auto_reply(uuid,integer,text,jsonb,text,jsonb,text,uuid,uuid)','EXECUTE') then
    raise exception 'Handoff RPC is exposed';
  end if;
  insert into public.email_auto_replies(mailbox_id,sender_id,user_id,assigned_to,root_message_id,thread_key,recipient,anchors,last_message_key)
    values(v_mailbox,v_mailbox,v_user,v_user,v_key,'message:'||v_key,'automation-test@example.test',array[v_key],v_key) returning id into v_auto;
  if (select enabled from public.email_auto_replies where id=v_auto) then raise exception 'Must default to off'; end if;
  update public.email_auto_replies set enabled=true,status='processing',revision=2 where id=v_auto;
  perform public.handoff_email_auto_reply(v_auto,2,'waiting_shipping','{"shippingAddress":"Synthetic destination","shippingMinor":0}',v_key,'[]','Confirm shipping');
  select task_id into v_task from public.email_auto_replies where id=v_auto and status='waiting_shipping';
  if v_task is null or not exists(select 1 from public.crm_tasks where id=v_task and assigned_to=v_user and status='open') then raise exception 'Shipping task missing'; end if;
  if not exists(select 1 from public.internal_notifications where user_id=v_user and conversation_id='message:'||v_key) then raise exception 'Notification missing'; end if;
  if not exists(select 1 from public.internal_notifications where user_id=v_user and task_id=v_task and event_key='auto-reply-handoff:'||v_auto||':2') then raise exception 'AI handoff alert is not linked to its review task'; end if;
  begin
    perform public.handoff_email_auto_reply(v_auto,1,'needs_review',null,v_key,'[]','Stale');
    raise exception 'Stale revision accepted';
  exception when others then if sqlerrm='Stale revision accepted' then raise; end if; end;
  insert into public.email_auto_reply_deliveries(automation_id,message_key,status) values(v_auto,v_key,'reserved');
  begin
    insert into public.email_auto_reply_deliveries(automation_id,message_key,status) values(v_auto,v_key,'reserved');
    raise exception 'Duplicate reservation accepted';
  exception when unique_violation then null; end;
  update public.email_auto_replies set enabled=false,status='paused',revision=3 where id=v_auto;
  begin
    perform public.handoff_email_auto_reply(v_auto,3,'waiting_shipping','{}',v_key,'[]','Stopped');
    raise exception 'Stopped automation accepted';
  exception when others then if sqlerrm='Stopped automation accepted' then raise; end if; end;
  update public.crm_tasks set status='cancelled' where id=v_task;
  if exists(select 1 from public.internal_notifications where task_id=v_task and read_at is null) then raise exception 'Resolved AI handoff still has unread alerts'; end if;
end $$;
rollback;
