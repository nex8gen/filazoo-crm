begin;
alter table public.crm_tasks
  add column created_by uuid references auth.users(id) on delete set null,
  add column assigned_by uuid references auth.users(id) on delete set null;
create index crm_tasks_created_by_idx on public.crm_tasks(created_by) where created_by is not null;
create index crm_tasks_assigned_by_status_idx on public.crm_tasks(assigned_by,status,created_at desc) where assigned_by is not null;

-- Validate the recipient inside the write transaction, including assignments
-- made by flows and concurrent membership changes. No new browser grants.
create function public.validate_crm_task_recipient() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.assigned_to is not distinct from old.assigned_to then return new; end if;
  end if;
  if new.assigned_to is not null then
    perform 1 from public.workspace_members
    where user_id=new.assigned_to and activated_at is not null and role in ('admin','operator','bd_manager') for share;
    if not found then raise exception 'Choose an active workspace member who can manage tasks.'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validate_crm_task_recipient() from public,anon,authenticated;
grant execute on function public.validate_crm_task_recipient() to service_role;
create trigger crm_tasks_validate_recipient before insert or update of assigned_to on public.crm_tasks
for each row execute function public.validate_crm_task_recipient();

create function public.notify_task_assigner_on_completion() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.status='done' and old.status<>'done' and new.assigned_by is not null
     and new.assigned_by is distinct from new.assigned_to
     and exists(select 1 from public.workspace_members where user_id=new.assigned_by and activated_at is not null) then
    insert into public.internal_notifications(user_id,task_id,message,event_key,include_thread_link)
    values(new.assigned_by,new.id,left('Task completed: '||new.title,500),'task-completed:'||new.id||':'||extract(epoch from new.updated_at),false)
    on conflict(event_key) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_task_assigner_on_completion() from public,anon,authenticated;
grant execute on function public.notify_task_assigner_on_completion() to service_role;
create trigger crm_tasks_notify_assigner after update of status on public.crm_tasks
for each row execute function public.notify_task_assigner_on_completion();
notify pgrst,'reload schema';
commit;
