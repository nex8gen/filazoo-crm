-- Executes against the connected CRM. No fixture or change survives rollback.
begin;
set local role service_role;
do $$
declare
  company uuid;
  actor uuid;
  manager uuid;
  task uuid;
  marker constant text := 'Scheduled from intelligent next follow-up recommendation.';
begin
  select user_id into strict actor from public.workspace_members where role='admin' and activated_at is not null limit 1;
  select user_id into strict manager from public.workspace_members where role='bd_manager' and auto_assign_leads and activated_at is not null limit 1;
  insert into public.companies(name) values('CRM connections rollback verification') returning id into company;
  insert into public.contacts(company_id,email) values(company,'crm-connections@example.invalid');
  insert into public.pipeline(company_id,owner_id,next_followup_at) values(company,manager,'2026-10-27T01:30:00Z');
  select id into strict task from public.crm_tasks where company_id=company and status='open' and notes=marker;
  if not exists(select 1 from public.crm_tasks where id=task and assigned_to=manager and due_at='2026-10-27T01:30:00Z') then raise exception 'Reminder time/owner was lost'; end if;
  update public.pipeline set next_followup_at='2026-10-28T01:30:00Z',stage='interested' where company_id=company;
  if (select count(*) from public.crm_tasks where company_id=company and status='open') <> 1 then raise exception 'Duplicate reminders'; end if;
  if not exists(select 1 from public.crm_tasks where id=task and due_at='2026-10-28T01:30:00Z' and priority='high') then raise exception 'Reminder was not rescheduled'; end if;
  perform public.assign_company_owner(company,null,actor);
  if not exists(select 1 from public.crm_tasks where id=task and assigned_to is null) then raise exception 'Unassigned company retained old reminder owner'; end if;
  perform public.assign_company_owner(company,manager,actor);
  if not exists(select 1 from public.crm_tasks where id=task and assigned_to=manager) then raise exception 'Reminder owner did not transfer'; end if;
  if (select count(*) from public.events where company_id=company and type='lead_owner_changed' and actor_id=actor) <> 2 then raise exception 'Missing assignment audit'; end if;
  begin
    perform public.assign_company_owner(company,actor,actor);
    raise exception 'TEST FAILED: invalid manager accepted';
  exception when raise_exception then if sqlerrm <> 'Choose an active BD Sales Manager.' then raise; end if; end;
  begin
    perform public.assign_company_owner(company,null,manager);
    raise exception 'TEST FAILED: manager reassigned company';
  exception when raise_exception then if sqlerrm <> 'Administrator access is required.' then raise; end if; end;
  if not exists(select 1 from public.pipeline where company_id=company and owner_id=manager and stage='interested') then raise exception 'Failed assignment changed pipeline'; end if;
  update public.pipeline set next_followup_at=null where company_id=company;
  if exists(select 1 from public.crm_tasks where company_id=company and status='open') then raise exception 'Reminder was not cancelled'; end if;
  update public.pipeline set next_followup_at='2026-10-29T01:30:00Z' where company_id=company;
  if (select count(*) from public.crm_tasks where company_id=company and status='open') <> 1 then raise exception 'Cannot schedule after cancellation'; end if;
  if has_function_privilege('anon','public.assign_company_owner(uuid,uuid,uuid)','execute') or has_function_privilege('authenticated','public.assign_company_owner(uuid,uuid,uuid)','execute') then raise exception 'Assignment RPC exposed to browser'; end if;
end $$;
rollback;
