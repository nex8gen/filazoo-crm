begin;

-- Every pipeline writer (profile, opportunity and automation) keeps the saved
-- reminder consistent in the same transaction. Row updates serialize concurrent
-- saves for one company, so retries cannot create duplicate open reminders.
create or replace function public.sync_company_followup_task() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  company_name text;
  contact uuid;
  task uuid;
  marker constant text := 'Scheduled from intelligent next follow-up recommendation.';
begin
  if tg_op = 'UPDATE' then
    if new.next_followup_at is not distinct from old.next_followup_at
       and new.owner_id is not distinct from old.owner_id
       and new.stage is not distinct from old.stage then return new; end if;
  end if;
  select name into company_name from public.companies where id = new.company_id;
  select id into contact from public.contacts where company_id = new.company_id order by created_at, id limit 1;
  select id into task from public.crm_tasks
    where company_id = new.company_id and status = 'open' and notes = marker
    order by created_at, id limit 1 for update;
  if new.next_followup_at is null then
    update public.crm_tasks set status = 'cancelled', updated_at = now()
      where company_id = new.company_id and status = 'open' and notes = marker;
  elsif task is not null then
    update public.crm_tasks set assigned_to = new.owner_id, due_at = new.next_followup_at,
      title = left('Follow up ' || company_name, 200), contact_id = contact,
      priority = case when new.stage in ('replied','interested','big_order') then 'high' else 'normal' end,
      updated_at = now() where id = task;
    update public.crm_tasks set status = 'cancelled', updated_at = now()
      where company_id = new.company_id and status = 'open' and notes = marker and id <> task;
  else
    insert into public.crm_tasks(company_id, contact_id, assigned_to, title, notes, priority, due_at)
    values(new.company_id, contact, new.owner_id, left('Follow up ' || company_name, 200), marker,
      case when new.stage in ('replied','interested','big_order') then 'high' else 'normal' end, new.next_followup_at);
  end if;
  return new;
end;
$$;
revoke all on function public.sync_company_followup_task() from public, anon, authenticated;
grant execute on function public.sync_company_followup_task() to service_role;
create trigger pipeline_sync_company_followup after insert or update of next_followup_at, owner_id, stage
  on public.pipeline for each row execute function public.sync_company_followup_task();

-- Assignment, source ownership, reminder ownership and audit history either all
-- commit or all roll back. Only the authenticated server can invoke this RPC.
create or replace function public.assign_company_owner(p_company_id uuid, p_owner_id uuid, p_actor_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  company_name text;
  owner_name text := 'Unassigned';
begin
  if not exists(select 1 from public.workspace_members where user_id = p_actor_id and role = 'admin' and activated_at is not null) then
    raise exception 'Administrator access is required.';
  end if;
  select name into company_name from public.companies where id = p_company_id for update;
  if not found then raise exception 'The company no longer exists.'; end if;
  if p_owner_id is not null then
    select coalesce(display_name, 'BD Sales Manager') into owner_name from public.workspace_members
      where user_id = p_owner_id and role = 'bd_manager' and auto_assign_leads = true and activated_at is not null for share;
    if not found then raise exception 'Choose an active BD Sales Manager.'; end if;
  end if;
  insert into public.pipeline(company_id, owner_id) values(p_company_id, p_owner_id)
    on conflict(company_id) do update set owner_id = excluded.owner_id, updated_at = now();
  update public.shopify_leads set owner_id = p_owner_id,
    assignment_method = case when p_owner_id is null then null else 'manual' end where company_id = p_company_id;
  update public.meta_leads set owner_id = p_owner_id,
    assignment_method = case when p_owner_id is null then null else 'manual' end where company_id = p_company_id;
  insert into public.events(company_id, actor_id, type, data) values(p_company_id, p_actor_id, 'lead_owner_changed',
    jsonb_build_object('summary', case when p_owner_id is null then company_name || ' was returned to the unassigned queue.'
      else company_name || ' was manually assigned to ' || owner_name || '.' end));
  return owner_name;
end;
$$;
revoke all on function public.assign_company_owner(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_company_owner(uuid, uuid, uuid) to service_role;

commit;
