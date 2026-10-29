begin;

create or replace function public.finish_agent_reply_request(p_id uuid,p_user_id uuid,p_revision integer,p_outcome text,p_evidence jsonb,p_notes text,p_thread_url text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare r public.agent_reply_requests; v_title text; v_message text; v_notification uuid;
begin
  select * into r from public.agent_reply_requests where id=p_id and user_id=p_user_id for update;
  if not found or r.revision<>p_revision then return false; end if;
  if p_outcome='received' then
    if r.status<>'waiting' or r.expires_at<=now() then return false; end if;
    if p_evidence is null or jsonb_typeof(p_evidence)<>'object'
       or nullif(r.message_id,'') is null or r.waiting_since is null
       or coalesce(lower(p_evidence->>'sender'),'')<>r.recipient or coalesce((p_evidence->>'automaticResponse')::boolean,true)
       or nullif(p_evidence->>'messageId','') is null
       or nullif(p_evidence->>'timestamp','') is null
       or (p_evidence->>'timestamp')::timestamptz<r.waiting_since
       or (p_evidence->>'timestamp')::timestamptz>r.expires_at
       or not coalesce((lower(p_evidence->>'inReplyTo')=lower(r.message_id) or coalesce(p_evidence->'references','[]'::jsonb) ? lower(r.message_id)),false)
    then return false; end if;
    v_title:=r.task_title;
    v_message:='Customer replied: ' || r.company_name || '. Review the reply and continue: ' || r.task_title;
  elsif p_outcome='expired' then
    if r.status<>'waiting' or r.expires_at>now() then return false; end if;
    v_title:=left('Follow up: ' || r.task_title,200);
    v_message:='Waiting period ended without a confirmed reply: ' || r.company_name || '. Review before following up.';
  elsif p_outcome='uncertain' then
    if r.status not in ('sending','uncertain') then return false; end if;
    v_title:=left('Check email delivery: ' || r.task_title,200);
    v_message:='Email delivery needs review for ' || r.company_name || '. Check Sent before sending again.';
  else raise exception 'Unsupported reply request transition'; end if;
  -- Recheck live membership, mailbox and assignment inside the transaction.
  -- The server worker checks Auth suspension using the admin Auth API;
  -- service_role deliberately has no direct access to auth.users.
  if not exists(select 1 from public.workspace_members m
    where m.user_id=r.user_id and m.role=r.owner_role and m.activated_at is not null)
    or not exists(select 1 from public.workspace_mailboxes b where b.id=r.mailbox_id and b.is_active
      and (b.type='workspace' or b.user_id=r.user_id)
      and (r.owner_role<>'bd_manager' or b.type='personal' or exists(select 1 from public.pipeline p where p.company_id=r.company_id and p.owner_id=r.user_id)))
    or not exists(select 1 from public.contacts c where c.company_id=r.company_id and lower(c.email)=r.recipient)
  then
    update public.agent_reply_requests set status='blocked',revision=revision+1,last_error='Mailbox, membership or customer access changed.',updated_at=now() where id=r.id;
    return false;
  end if;
  insert into public.crm_tasks(id,company_id,assigned_to,title,notes,priority,status,due_at)
    values(r.id,r.company_id,r.user_id,v_title,left(p_notes,24000),r.task_priority,'open',null)
    on conflict(id) do nothing;
  -- Task assignment may already have created an alert through crm_tasks_activity.
  -- Reuse it in this same transaction instead of notifying the user twice.
  select id into v_notification from public.internal_notifications
    where task_id=r.id and user_id=r.user_id order by created_at,id limit 1;
  if v_notification is null then
    insert into public.internal_notifications(id,user_id,message,conversation_id,include_thread_link,task_id)
      values(r.id,r.user_id,left(v_message,500),p_thread_url,false,r.id) on conflict(id) do nothing;
  else
    update public.internal_notifications set message=left(v_message,500),conversation_id=p_thread_url,include_thread_link=false
      where id=v_notification and user_id=r.user_id;
  end if;
  update public.agent_reply_requests set status=p_outcome,revision=revision+1,reply_evidence=p_evidence,
    task_id=r.id,last_checked_at=now(),updated_at=now() where id=r.id;
  return true;
end;
$$;
notify pgrst,'reload schema';
commit;
