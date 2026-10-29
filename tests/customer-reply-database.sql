-- Transactional service-role integration test; all fixture changes roll back.
begin;
set local role service_role;
do $$
declare
  v_id uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid();
  v_actor uuid:='9755e816-c3a5-43e3-b83c-a3748199e529';
  v_company uuid:='dbe22b72-e614-420d-a6ed-cdf8128f4030';
  v_mailbox uuid:='440b5373-a8ec-4aec-bc36-3dead46d9020';
  v_evidence jsonb;
begin
  if not exists(select 1 from public.companies where id=v_company and name like 'AI AUDIT%DO NOT CONTACT%') then raise exception 'Synthetic company unavailable'; end if;
  insert into public.contacts(company_id,name,email) values(v_company,'TEST ONLY reply workflow fixture','reply-fixture@example.invalid');
  insert into public.agent_reply_requests(id,user_id,owner_role,company_id,company_name,mailbox_id,recipient,subject,body,needed,task_title,task_notes,scope_key,status,message_id,waiting_since,expires_at)
    values(v_id,v_actor,'admin',v_company,'TEST ONLY reply fixture',v_mailbox,'reply-fixture@example.invalid','TEST ONLY','',array['shipping_address'],'TEST ONLY review then invoice','100 PLA; confirm shipping','test-'||v_id,'waiting','<test-outgoing@example.com>',now()-interval '1 minute',now()+interval '1 day');
  begin
    insert into public.agent_reply_requests select v_other,user_id,owner_role,company_id,company_name,mailbox_id,recipient,subject,body,needed,task_title,task_notes,task_priority,invoice_id,invoice_context,scope_key,status,revision,message_id,thread_key,sent_record_id,waiting_since,send_started_at,expires_at,last_checked_at,last_error,reply_evidence,task_id,created_at,updated_at from public.agent_reply_requests where id=v_id;
    raise exception 'Duplicate active scope unexpectedly accepted';
  exception when unique_violation then null; end;
  v_evidence:=jsonb_build_object('sender','reply-fixture@example.invalid','automaticResponse',false,'messageId','<reply@example.com>','timestamp',now(),'inReplyTo','<test-outgoing@example.com>','references','[]'::jsonb);
  if public.finish_agent_reply_request(v_id,v_actor,1,'received','{}','Bad evidence','/emails') then raise exception 'Empty evidence accepted'; end if;
  if public.finish_agent_reply_request(v_id,v_actor,1,'received',v_evidence-'inReplyTo','Bad thread','/emails') then raise exception 'Missing thread accepted'; end if;
  if public.finish_agent_reply_request(v_id,v_actor,1,'received',v_evidence||'{"sender":"other@example.com"}','Wrong sender','/emails') then raise exception 'Wrong sender accepted'; end if;
  if public.finish_agent_reply_request(v_id,v_actor,1,'received',v_evidence||'{"automaticResponse":true}','OOO','/emails') then raise exception 'Automatic response accepted'; end if;
  if public.finish_agent_reply_request(v_id,v_other,1,'received',v_evidence,'Wrong owner','/emails') then raise exception 'Wrong owner accepted'; end if;
  if not public.finish_agent_reply_request(v_id,v_actor,1,'received',v_evidence,'TEST ONLY review customer reply. No invoice sent.','/emails') then raise exception 'Valid reply failed'; end if;
  if public.finish_agent_reply_request(v_id,v_actor,1,'received',v_evidence,'Repeat','/emails') then raise exception 'Duplicate transition accepted'; end if;
  if (select count(*) from public.crm_tasks where id=v_id and assigned_to=v_actor)<>1 or (select count(*) from public.internal_notifications where task_id=v_id and user_id=v_actor)<>1 then raise exception 'Expected one assigned task and notification'; end if;
  if (select due_at from public.crm_tasks where id=v_id) is not null then raise exception 'Unexpected extra due-reminder'; end if;
  update public.agent_reply_requests set status='cancelled',revision=3 where id=v_id;
  if public.finish_agent_reply_request(v_id,v_actor,3,'received',v_evidence,'Cancelled','/emails') then raise exception 'Cancelled wait resumed'; end if;
  update public.agent_reply_requests set status='waiting',revision=4,expires_at=now()-interval '1 second' where id=v_id;
  if public.finish_agent_reply_request(v_id,v_actor,4,'received',v_evidence,'Too late','/emails') then raise exception 'Expired reply accepted'; end if;
  if not public.finish_agent_reply_request(v_id,v_actor,4,'expired',null,'TEST ONLY expiry','/emails') then raise exception 'Expiry failed'; end if;
  update public.agent_reply_requests set status='uncertain',revision=6 where id=v_id;
  if not public.finish_agent_reply_request(v_id,v_actor,6,'uncertain',null,'TEST ONLY delivery review','/emails') then raise exception 'Uncertain transition failed'; end if;
  update public.agent_reply_requests set status='waiting',revision=8,expires_at=now()+interval '1 day',mailbox_id=null where id=v_id;
  if public.finish_agent_reply_request(v_id,v_actor,8,'received',v_evidence,'Removed mailbox','/emails') then raise exception 'Removed mailbox accepted'; end if;
  if (select status from public.agent_reply_requests where id=v_id)<>'blocked' then raise exception 'Access change not blocked'; end if;
end;
$$;
reset role;
select 'Reply workflow transaction tests passed; fixtures rolled back.' as result;
rollback;
