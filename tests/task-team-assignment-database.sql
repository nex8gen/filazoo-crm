-- Synthetic users, tasks and notifications are all rolled back.
begin;
create temporary table task_team_fixture(label text primary key,id uuid not null default gen_random_uuid());
insert into task_team_fixture(label) values('sender'),('recipient'),('viewer'),('pending');
grant select on task_team_fixture to service_role;
insert into auth.users(id,email) select id,id::text||'@task-team.example.invalid' from task_team_fixture;
insert into public.workspace_members(user_id,display_name,role,activated_at,auto_assign_leads)
select id,label,case when label='viewer' then 'viewer' when label='sender' then 'admin' else 'operator' end,
case when label='pending' then null else now() end,false from task_team_fixture;
set local role service_role;
do $$
declare
  sender uuid := (select id from task_team_fixture where label='sender');
  recipient uuid := (select id from task_team_fixture where label='recipient');
  invalid uuid;
  task uuid;
begin
  insert into public.crm_tasks(title,assigned_to,created_by,assigned_by)
    values('Workspace assignment rollback test',recipient,sender,sender) returning id into task;
  if not exists(select 1 from public.internal_notifications where task_id=task and user_id=recipient and read_at is null) then raise exception 'Assignee was not notified'; end if;
  if not exists(select 1 from public.crm_tasks where id=task and assigned_by=sender and created_by=sender and assigned_to=recipient) then raise exception 'Assignment provenance missing'; end if;
  for invalid in select id from task_team_fixture where label in ('viewer','pending') union all select gen_random_uuid()
  loop
    begin
      update public.crm_tasks set assigned_to=invalid where id=task;
      raise exception 'TEST FAILED: inactive or read-only assignee accepted';
    exception when raise_exception then
      if sqlerrm <> 'Choose an active workspace member who can manage tasks.' then raise; end if;
    end;
  end loop;
  if not exists(select 1 from public.crm_tasks where id=task and assigned_to=recipient) then raise exception 'Rejected reassignment changed the recipient'; end if;
  update public.crm_tasks set status='done',completed_at=now() where id=task;
  update public.crm_tasks set status='done' where id=task;
  if (select count(*) from public.internal_notifications where task_id=task and user_id=sender and event_key like 'task-completed:%')<>1 then raise exception 'Completion alert missing or duplicated'; end if;
  if exists(select 1 from public.internal_notifications where task_id=task and user_id=recipient and read_at is null) then raise exception 'Completed work still alerts the assignee'; end if;
  if has_function_privilege('authenticated','public.validate_crm_task_recipient()','execute') or has_function_privilege('anon','public.notify_task_assigner_on_completion()','execute') then raise exception 'Task trigger functions exposed'; end if;
  if has_table_privilege('authenticated','public.crm_tasks','select') then raise exception 'Private tasks exposed'; end if;
end $$;
rollback;
