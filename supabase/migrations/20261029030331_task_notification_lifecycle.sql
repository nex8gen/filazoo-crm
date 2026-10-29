begin;

alter table public.crm_tasks add column follows_company_owner boolean not null default false;
alter table public.internal_notifications
  add column task_id uuid references public.crm_tasks(id) on delete cascade,
  add column event_key text unique,
  add column is_unread boolean generated always as (read_at is null) stored;
create index internal_notifications_task_idx on public.internal_notifications(task_id) where task_id is not null;
create index internal_notifications_inbox_idx on public.internal_notifications(user_id,is_unread desc,created_at desc,id);
create index crm_tasks_due_reminder_idx on public.crm_tasks(due_at,id) where status='open' and assigned_to is not null;

update public.crm_tasks set follows_company_owner=true
where notes='Scheduled from intelligent next follow-up recommendation.' or notes like 'Company purchase analysis: %';

-- Every producer (CRM, flows, AI and product analysis) shares the same lifecycle.
create function public.sync_crm_task_activity() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
  assigned boolean := false;
  marker constant text := 'Scheduled from intelligent next follow-up recommendation.';
begin
  if tg_op='INSERT' then
    assigned := new.status='open' and new.assigned_to is not null;
  else
    -- Retire obsolete reminders; history remains visible as read.
    if new.status<>'open' or new.assigned_to is distinct from old.assigned_to then
      update public.internal_notifications set read_at=coalesce(read_at,now())
      where task_id=new.id and read_at is null;
    elsif new.due_at is distinct from old.due_at then
      update public.internal_notifications set read_at=coalesce(read_at,now())
      where task_id=new.id and event_key like 'task-due:%' and read_at is null;
    end if;
    assigned := new.status='open' and new.assigned_to is not null
      and (old.status<>'open' or new.assigned_to is distinct from old.assigned_to);

    -- Only the currently scheduled reminder may change the company's date.
    -- The pipeline trigger sees the same date and cannot recreate a closed task.
    if old.notes=marker and old.status='open' and new.company_id is not null then
      if new.status<>'open' then
        update public.pipeline set next_followup_at=null
        where company_id=new.company_id and next_followup_at=old.due_at
          and not exists(select 1 from public.crm_tasks t where t.company_id=new.company_id and t.id<>new.id and t.status='open' and t.notes=marker);
      elsif new.due_at is distinct from old.due_at then
        update public.pipeline set next_followup_at=new.due_at
        where company_id=new.company_id and next_followup_at=old.due_at;
      end if;
    end if;
  end if;
  if assigned and exists(select 1 from public.workspace_members where user_id=new.assigned_to and activated_at is not null) then
    insert into public.internal_notifications(user_id,message,task_id,include_thread_link)
    values(new.assigned_to,left('Task assigned: '||new.title,500),new.id,false);
  end if;
  return new;
end;
$$;
revoke all on function public.sync_crm_task_activity() from public,anon,authenticated;
grant execute on function public.sync_crm_task_activity() to service_role;
create trigger crm_tasks_activity after insert or update of status,due_at,assigned_to on public.crm_tasks
for each row execute function public.sync_crm_task_activity();

create function public.transfer_company_followup_tasks() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.owner_id is distinct from old.owner_id then
    update public.crm_tasks set assigned_to=new.owner_id
    where company_id=new.company_id and status='open'
      and (follows_company_owner or notes='Scheduled from intelligent next follow-up recommendation.' or notes like 'Company purchase analysis: %')
      and assigned_to is distinct from new.owner_id;
  end if;
  return new;
end;
$$;
revoke all on function public.transfer_company_followup_tasks() from public,anon,authenticated;
grant execute on function public.transfer_company_followup_tasks() to service_role;
create trigger pipeline_transfer_followup_tasks after update of owner_id on public.pipeline
for each row execute function public.transfer_company_followup_tasks();

-- Link AI handoff alerts to their task so resolving or stopping the handoff
-- clears its unread alert and opens the correct review controls from history.
create or replace function public.handoff_email_auto_reply(
  p_id uuid, p_revision integer, p_status text, p_document jsonb, p_message_key text,
  p_history jsonb, p_reason text, p_company_id uuid default null, p_contact_id uuid default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare a public.email_auto_replies; v_task uuid;
begin
  select * into a from public.email_auto_replies where id=p_id for update;
  if a.id is null or not a.enabled or a.revision <> p_revision or a.status <> 'processing' then
    raise exception 'Automation changed or was stopped';
  end if;
  if p_status not in ('waiting_shipping','needs_review') then raise exception 'Invalid handoff'; end if;
  v_task := coalesce(a.task_id, gen_random_uuid());
  insert into public.crm_tasks(id,company_id,contact_id,assigned_to,title,notes,priority,status,due_at)
    values(v_task,p_company_id,p_contact_id,a.assigned_to,
      case when p_status='waiting_shipping' then 'Add shipping cost to send customer invoice' else 'Review AI email reply' end,
      left(p_reason,4000) || E'\nOpen conversation: /emails?mailbox=' || a.mailbox_id::text || '&thread=' || a.thread_key,
      'high','open',now())
    on conflict(id) do update set title=excluded.title,notes=excluded.notes,status='open',completed_at=null,assigned_to=excluded.assigned_to;
  insert into public.internal_notifications(user_id,message,conversation_id,include_thread_link,task_id,event_key)
    values(a.assigned_to,left(case when p_status='waiting_shipping' then 'Shipping approval required: ' else 'AI reply needs review: ' end || a.recipient || '. ' || p_reason,500),a.thread_key,true,v_task,'auto-reply-handoff:'||a.id||':'||p_revision)
    on conflict(event_key) do nothing;
  update public.email_auto_replies set status=p_status,pending_document=p_document,pending_message_key=p_message_key,
    history=p_history,task_id=v_task,last_error=p_reason,processing_at=null where id=p_id;
end;
$$;
revoke all on function public.handoff_email_auto_reply(uuid,integer,text,jsonb,text,jsonb,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.handoff_email_auto_reply(uuid,integer,text,jsonb,text,jsonb,text,uuid,uuid) to service_role;

-- A task due at the same instant is notified once per recipient, even when
-- multiple schedulers run. Row locks serialize completion and notification.
create function public.notify_due_crm_tasks() returns integer
language plpgsql security invoker set search_path='' as $$
declare
  task record;
  inserted integer;
  total integer := 0;
begin
  for task in
    select t.id,t.title,t.assigned_to,t.due_at,
      'task-due:'||t.id||':'||t.assigned_to||':'||extract(epoch from t.due_at) as reminder_key
    from public.crm_tasks t join public.workspace_members m on m.user_id=t.assigned_to and m.activated_at is not null
    where t.status='open' and t.due_at<=now()
      and not exists(select 1 from public.internal_notifications n where n.event_key='task-due:'||t.id||':'||t.assigned_to||':'||extract(epoch from t.due_at))
    order by t.due_at,t.id limit 500 for update of t skip locked
  loop
    insert into public.internal_notifications(user_id,message,task_id,event_key,include_thread_link)
    values(task.assigned_to,left('Task due: '||task.title,500),task.id,task.reminder_key,false)
    on conflict(event_key) do nothing;
    get diagnostics inserted = row_count;
    total := total+inserted;
  end loop;
  return total;
end;
$$;
revoke all on function public.notify_due_crm_tasks() from public,anon,authenticated;
grant execute on function public.notify_due_crm_tasks() to service_role;

create extension if not exists pg_cron;
select cron.schedule('filazoo-task-due-reminders','* * * * *','select public.notify_due_crm_tasks();');
notify pgrst,'reload schema';
commit;
