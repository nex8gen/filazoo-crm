-- Run against the connected CRM after applying the member-removal migration.
-- All fixtures, pool changes, failure injection, and removals roll back.
begin;
set local statement_timeout = '60s';
lock table public.workspace_members in share row exclusive mode;

create temporary table removal_fixture (name text primary key, id uuid not null default gen_random_uuid());
insert into removal_fixture(name) values
  ('actor'), ('removed'), ('manager_a'), ('manager_b'), ('opted_out'), ('inactive'), ('viewer'),
  ('customer_1'), ('customer_2'), ('customer_3'), ('customer_4'), ('customer_5'), ('customer_6'),
  ('existing_1'), ('existing_2'), ('task'), ('flow'), ('mailbox');
grant select on removal_fixture to service_role;
insert into auth.users(id, email)
  select id, id::text || '@member-removal.example.invalid' from removal_fixture
  where name in ('actor', 'removed', 'manager_a', 'manager_b', 'opted_out', 'inactive', 'viewer');

-- Isolate the eligible pool without committing changes to any real member.
update public.workspace_members set auto_assign_leads = false where role = 'bd_manager';
insert into public.workspace_members(user_id, display_name, role, auto_assign_leads, activated_at)
  select id, name, case when name = 'actor' then 'admin' when name = 'viewer' then 'viewer' else 'bd_manager' end,
    name <> 'opted_out', case when name = 'inactive' then null else now() end
  from removal_fixture where name in ('actor', 'removed', 'manager_a', 'manager_b', 'opted_out', 'inactive', 'viewer');

insert into public.companies(id, name)
  select id, 'Member removal rollback test ' || name from removal_fixture where name like 'customer_%' or name like 'existing_%';
insert into public.pipeline(company_id, owner_id, stage, notes, next_followup_at)
  select id,
    (select id from removal_fixture where name = case when fixture.name like 'customer_%' then 'removed' else 'manager_a' end),
    'interested', 'Preserve this history', '2026-11-01T09:00:00Z'
  from removal_fixture fixture where name like 'customer_%' or name like 'existing_%';
insert into public.meta_leads(leadgen_id, page_id, company_id, owner_id, assignment_method)
  select id::text, 'member-removal-test', id, (select id from removal_fixture where name = 'removed'), 'manual'
  from removal_fixture where name = 'customer_1';
insert into public.shopify_leads(webhook_id, shop_domain, customer_id, email, company_name, status, company_id, owner_id, assignment_method)
  select id::text, 'member-removal-test.myshopify.com', id::text, id::text || '@example.invalid',
    'Removal test', 'processed', id, (select id from removal_fixture where name = 'removed'), 'manual'
  from removal_fixture where name = 'customer_1';
-- Unlinked source leads must also leave the removed manager.
insert into public.meta_leads(leadgen_id, page_id, owner_id, assignment_method)
  select id::text || '-unlinked', 'member-removal-test', id, 'manual' from removal_fixture where name = 'removed';
insert into public.shopify_leads(webhook_id, shop_domain, customer_id, email, company_name, status, owner_id, assignment_method)
  select id::text || '-unlinked', 'member-removal-test.myshopify.com', id::text,
    id::text || '@example.invalid', 'Unlinked removal test', 'processing', id, 'manual'
  from removal_fixture where name = 'removed';
insert into public.crm_tasks(id, company_id, assigned_to, title)
  select id, (select id from removal_fixture where name = 'customer_1'),
    (select id from removal_fixture where name = 'removed'), 'Preserve manual customer task'
  from removal_fixture where name = 'task';
insert into public.flows(id, user_id, created_by, name, trigger_type, status)
  select id, (select id from removal_fixture where name = 'removed'),
    (select id from removal_fixture where name = 'actor'), 'Member removal test flow', 'email_received', 'live'
  from removal_fixture where name = 'flow';
insert into public.email_automation_settings(user_id, enabled)
  select id, true from removal_fixture where name = 'removed';
insert into public.workspace_mailboxes(id, user_id, type, email)
  select id, (select id from removal_fixture where name = 'removed'), 'personal', id::text || '@example.invalid'
  from removal_fixture where name = 'mailbox';

-- Fail after the ownership changes and cleanup, verifying full rollback.
create function pg_temp.reject_test_member_removal() returns trigger language plpgsql as $$
begin
  if new.type = 'workspace_member_deleted' and current_setting('filazoo.test_remove_failure', true) = 'on' then
    raise exception 'Injected removal failure';
  end if;
  return new;
end;
$$;
create trigger reject_test_member_removal before insert on public.events
  for each row execute function pg_temp.reject_test_member_removal();

set local role service_role;
do $$
declare
  actor uuid := (select id from removal_fixture where name = 'actor');
  removed uuid := (select id from removal_fixture where name = 'removed');
  manager_a uuid := (select id from removal_fixture where name = 'manager_a');
  manager_b uuid := (select id from removal_fixture where name = 'manager_b');
  company uuid := (select id from removal_fixture where name = 'customer_1');
  result jsonb;
begin
  begin
    perform public.remove_workspace_member(removed, manager_a);
    raise exception 'TEST FAILED: non-admin removed a member';
  exception when raise_exception then if sqlerrm <> 'Administrator access is required.' then raise; end if; end;
  begin
    perform public.remove_workspace_member(actor, actor);
    raise exception 'TEST FAILED: self deletion succeeded';
  exception when raise_exception then if sqlerrm <> 'You cannot delete your own administrator account.' then raise; end if; end;
  begin
    perform public.remove_workspace_member(gen_random_uuid(), actor);
    raise exception 'TEST FAILED: missing member removal succeeded';
  exception when raise_exception then if sqlerrm <> 'The team member could not be found.' then raise; end if; end;

  perform set_config('filazoo.test_remove_failure', 'on', true);
  begin
    perform public.remove_workspace_member(removed, actor);
    raise exception 'TEST FAILED: injected failure did not run';
  exception when raise_exception then if sqlerrm <> 'Injected removal failure' then raise; end if; end;
  if not exists(select 1 from public.workspace_members where user_id = removed)
     or (select count(*) from public.pipeline where owner_id = removed) <> 6
     or not exists(select 1 from public.flows where id = (select id from removal_fixture where name = 'flow') and status = 'live')
     or not exists(select 1 from public.workspace_mailboxes where user_id = removed)
     or not exists(select 1 from public.email_automation_settings where user_id = removed and enabled)
     or not exists(select 1 from public.crm_tasks where id = (select id from removal_fixture where name = 'task') and assigned_to = removed)
  then raise exception 'Failed removal did not restore access, ownership, tasks, and automation'; end if;
  perform set_config('filazoo.test_remove_failure', 'off', true);

  result := public.remove_workspace_member(removed, actor);
  if result <> '{"reassigned":8,"unassigned":0}'::jsonb then raise exception 'Wrong reassignment counts: %', result; end if;
  if exists(select 1 from public.workspace_members where user_id = removed) then raise exception 'Removed member retains access'; end if;
  if (select count(*) from public.pipeline where owner_id = manager_a) <> 4
     or (select count(*) from public.pipeline where owner_id = manager_b) <> 4
  then raise exception 'Customer workloads were not balanced'; end if;
  if exists(select 1 from public.pipeline where company_id in (select id from removal_fixture where name like 'customer_%')
      and (owner_id is null or owner_id not in (manager_a, manager_b) or stage <> 'interested' or notes <> 'Preserve this history' or next_followup_at <> '2026-11-01T09:00:00Z'))
  then raise exception 'Customers lost their owner or pipeline history'; end if;
  if exists(select 1 from public.meta_leads lead join public.pipeline pipe using(company_id) where lead.company_id = company and lead.owner_id is distinct from pipe.owner_id)
     or exists(select 1 from public.shopify_leads lead join public.pipeline pipe using(company_id) where lead.company_id = company and lead.owner_id is distinct from pipe.owner_id)
     or exists(select 1 from public.crm_tasks task join public.pipeline pipe using(company_id) where task.company_id = company and task.assigned_to is distinct from pipe.owner_id)
  then raise exception 'Linked leads or follow-up tasks have inconsistent ownership'; end if;
  if exists(select 1 from public.meta_leads where owner_id = removed)
     or exists(select 1 from public.shopify_leads where owner_id = removed)
     or exists(select 1 from public.crm_tasks where assigned_to = removed)
     or exists(select 1 from public.flows where user_id = removed and status = 'live')
     or exists(select 1 from public.email_automation_settings where user_id = removed and enabled)
     or exists(select 1 from public.workspace_mailboxes where user_id = removed)
  then raise exception 'Removed member retains ownership or active automation'; end if;
  if (select count(*) from public.events where actor_id = actor and type = 'lead_owner_changed' and data->>'previous_owner_id' = removed::text) <> 6
  then raise exception 'Missing customer transfer audit history'; end if;

  -- Two remaining managers -> one remaining manager -> no eligible managers.
  perform public.remove_workspace_member(manager_a, actor);
  if exists(select 1 from public.pipeline where company_id in (select id from removal_fixture where name like 'customer_%' or name like 'existing_%') and owner_id is distinct from manager_b)
  then raise exception 'Sole remaining manager did not receive all affected customers'; end if;
  perform public.remove_workspace_member(manager_b, actor);
  if exists(select 1 from public.pipeline where company_id in (select id from removal_fixture where name like 'customer_%' or name like 'existing_%') and owner_id is not null)
     or exists(select 1 from public.meta_leads where page_id = 'member-removal-test' and (owner_id is not null or assignment_method is not null))
     or exists(select 1 from public.shopify_leads where shop_domain = 'member-removal-test.myshopify.com' and (owner_id is not null or assignment_method is not null))
  then raise exception 'No-manager removal did not preserve unassigned customers'; end if;
  if has_function_privilege('anon', 'public.remove_workspace_member(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.remove_workspace_member(uuid,uuid)', 'execute')
  then raise exception 'Removal RPC exposed to browser'; end if;
end;
$$;
rollback;
