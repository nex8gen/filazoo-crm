-- Integration checks against the connected CRM. Every fixture is rolled back.
begin;
set local role service_role;
do $$
declare
  actor uuid;
  teammate uuid;
  company uuid;
  scheduled uuid;
  product_task uuid;
  owner_task uuid;
  personal_task uuid;
  future_task uuid;
  old_due timestamptz := now()-interval '1 hour';
  marker constant text := 'Scheduled from intelligent next follow-up recommendation.';
begin
  select user_id into strict actor from public.workspace_members where activated_at is not null and role='admin' limit 1;
  select user_id into strict teammate from public.workspace_members where activated_at is not null and user_id<>actor limit 1;
  insert into public.companies(name) values('Task notification rollback verification') returning id into company;
  insert into public.pipeline(company_id,owner_id,next_followup_at) values(company,actor,old_due);
  select id into strict scheduled from public.crm_tasks where company_id=company and notes=marker and status='open';
  if (select count(*) from public.internal_notifications where task_id=scheduled and user_id=actor and read_at is null)<>1 then raise exception 'Missing assignment notification'; end if;
  perform public.notify_due_crm_tasks(); perform public.notify_due_crm_tasks();
  if (select count(*) from public.internal_notifications where task_id=scheduled and event_key like 'task-due:%')<>1 then raise exception 'Due reminders missing or duplicated'; end if;
  update public.crm_tasks set due_at=now()+interval '1 day' where id=scheduled;
  if not exists(select 1 from public.pipeline p join public.crm_tasks t on t.company_id=p.company_id where t.id=scheduled and p.next_followup_at=t.due_at) then raise exception 'Task reschedule did not update company'; end if;
  if exists(select 1 from public.internal_notifications where task_id=scheduled and event_key like 'task-due:%' and read_at is null) then raise exception 'Old due reminder remains unread'; end if;
  update public.crm_tasks set status='done',completed_at=now() where id=scheduled;
  if exists(select 1 from public.pipeline where company_id=company and next_followup_at is not null) then raise exception 'Completion left stale company follow-up'; end if;
  if exists(select 1 from public.internal_notifications where task_id=scheduled and read_at is null) then raise exception 'Closed task has unread reminders'; end if;
  update public.pipeline set stage='interested' where company_id=company;
  if exists(select 1 from public.crm_tasks where company_id=company and status='open') then raise exception 'Stage change recreated completed reminder'; end if;

  insert into public.crm_tasks(company_id,assigned_to,title,notes,due_at,follows_company_owner)
    values(company,actor,'Product check','Company purchase analysis: audit',old_due,true) returning id into product_task;
  insert into public.crm_tasks(company_id,assigned_to,title,due_at,follows_company_owner)
    values(company,actor,'Flow owner task',old_due,true) returning id into owner_task;
  insert into public.crm_tasks(company_id,assigned_to,title,due_at)
    values(company,actor,'Personal or explicit-assignee task',old_due) returning id into personal_task;
  insert into public.crm_tasks(company_id,assigned_to,title,due_at)
    values(company,actor,'Future task',now()+interval '1 day') returning id into future_task;
  update public.pipeline set owner_id=teammate where company_id=company;
  if (select count(*) from public.crm_tasks where id in (product_task,owner_task) and assigned_to=teammate)<>2 then raise exception 'Account-owner follow-ups did not transfer'; end if;
  if not exists(select 1 from public.crm_tasks where id=personal_task and assigned_to=actor) then raise exception 'Explicit assignment was overwritten'; end if;
  if exists(select 1 from public.internal_notifications where task_id in (product_task,owner_task) and user_id=actor and read_at is null) then raise exception 'Previous owner retains unread alerts'; end if;
  perform public.notify_due_crm_tasks(); perform public.notify_due_crm_tasks();
  if (select count(*) from public.internal_notifications where task_id in (product_task,owner_task) and user_id=teammate and event_key like 'task-due:%')<>2 then raise exception 'New owner lacks due reminders'; end if;
  if exists(select 1 from public.internal_notifications where task_id=future_task and event_key like 'task-due:%') then raise exception 'Future task notified early'; end if;
  update public.crm_tasks set status='cancelled' where id=owner_task;
  if exists(select 1 from public.internal_notifications where task_id=owner_task and read_at is null) then raise exception 'Cancelled task still has unread alerts'; end if;

  update public.pipeline set next_followup_at=now()+interval '2 days' where company_id=company;
  select id into strict scheduled from public.crm_tasks where company_id=company and notes=marker and status='open';
  -- Duplicate cleanup must not clear the date belonging to the retained task.
  insert into public.crm_tasks(company_id,assigned_to,title,notes,due_at)
    select company,teammate,'Duplicate fixture',marker,next_followup_at from public.pipeline where company_id=company;
  update public.pipeline set stage='replied' where company_id=company;
  if not exists(select 1 from public.pipeline where company_id=company and next_followup_at is not null) then raise exception 'Duplicate cleanup cleared company date'; end if;
  if (select count(*) from public.crm_tasks where company_id=company and notes=marker and status='open')<>1 then raise exception 'Duplicate cleanup failed'; end if;
  update public.crm_tasks set status='cancelled' where company_id=company and notes=marker and status='open';
  if exists(select 1 from public.pipeline where company_id=company and next_followup_at is not null) then raise exception 'Cancellation did not clear schedule'; end if;
  if has_function_privilege('anon','public.notify_due_crm_tasks()','execute') or has_function_privilege('authenticated','public.notify_due_crm_tasks()','execute') then raise exception 'Reminder function exposed to browser'; end if;
  if has_table_privilege('anon','public.crm_tasks','select') or has_table_privilege('authenticated','public.internal_notifications','select') then raise exception 'Private activity tables exposed to browser'; end if;
end $$;
rollback;
