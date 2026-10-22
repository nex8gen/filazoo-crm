begin;

-- Whenever the eligible BD pool changes, a sole active manager owns every
-- currently unassigned customer. Existing ownership is never moved when a
-- second manager joins; claim_next_bd_sales_manager continues to round-robin
-- only future leads across the active pool.
create or replace function public.assign_unowned_leads_to_sole_bd_manager() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  eligible_manager_ids uuid[];
  sole_manager_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('filazoo_bd_lead_assignment'));

  select array_agg(member.user_id order by member.created_at, member.user_id)
    into eligible_manager_ids
  from public.workspace_members member
  where member.role = 'bd_manager'
    and member.auto_assign_leads = true
    and member.activated_at is not null;

  if coalesce(cardinality(eligible_manager_ids), 0) <> 1 then
    return null;
  end if;

  sole_manager_id := eligible_manager_ids[1];

  update public.pipeline
  set owner_id = sole_manager_id, updated_at = clock_timestamp()
  where owner_id is null;

  update public.shopify_leads
  set owner_id = sole_manager_id,
      assignment_method = 'automatic',
      updated_at = clock_timestamp()
  where owner_id is null and status = 'processed';

  update public.meta_leads
  set owner_id = sole_manager_id,
      assignment_method = 'automatic',
      updated_at = clock_timestamp()
  where owner_id is null;

  return null;
end;
$$;

drop trigger if exists workspace_members_assign_unowned_to_sole_bd on public.workspace_members;
drop trigger if exists workspace_members_assign_unowned_to_sole_bd_insert on public.workspace_members;
drop trigger if exists workspace_members_assign_unowned_to_sole_bd_update on public.workspace_members;
drop trigger if exists workspace_members_assign_unowned_to_sole_bd_delete on public.workspace_members;
create trigger workspace_members_assign_unowned_to_sole_bd_insert
after insert on public.workspace_members
for each statement execute function public.assign_unowned_leads_to_sole_bd_manager();
create trigger workspace_members_assign_unowned_to_sole_bd_update
after update of role, auto_assign_leads, activated_at on public.workspace_members
for each statement execute function public.assign_unowned_leads_to_sole_bd_manager();
create trigger workspace_members_assign_unowned_to_sole_bd_delete
after delete on public.workspace_members
for each statement execute function public.assign_unowned_leads_to_sole_bd_manager();

revoke all on function public.assign_unowned_leads_to_sole_bd_manager() from public, anon, authenticated;

-- Run the rule once during deployment for workspaces that already have a sole
-- active manager. UPDATE OF statement triggers also fire when no rows match.
update public.workspace_members set auto_assign_leads = auto_assign_leads where false;

commit;
