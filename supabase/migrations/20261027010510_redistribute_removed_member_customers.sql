begin;

-- Reassert the workload-aware allocator for databases still using the earlier
-- timestamp-only round robin implementation.
-- Assign new customer/company profiles to the eligible active BD Manager with
-- the fewest current pipeline records. The timestamp keeps ties deterministic
-- and prevents the same manager from repeatedly winning an equal-load tie.
create or replace function public.claim_next_bd_sales_manager() returns uuid
language plpgsql security invoker set search_path = public as $$
declare selected_user_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('filazoo_bd_lead_assignment'));

  select member.user_id into selected_user_id
  from public.workspace_members member
  where member.role = 'bd_manager'
    and member.auto_assign_leads = true
    and member.activated_at is not null
  order by (
    select count(*)
    from public.pipeline assigned_pipeline
    where assigned_pipeline.owner_id = member.user_id
  ) asc,
  member.last_lead_assigned_at asc nulls first,
  member.created_at asc,
  member.user_id asc
  limit 1
  for update;

  if selected_user_id is not null then
    update public.workspace_members
    set last_lead_assigned_at = clock_timestamp()
    where user_id = selected_user_id;
  end if;

  return selected_user_id;
end;
$$;

revoke all on function public.claim_next_bd_sales_manager() from public, anon, authenticated;
grant execute on function public.claim_next_bd_sales_manager() to service_role;

-- Remove access and transfer ownership in one transaction. The existing pool
-- lock serializes this operation with automatic BD assignments and removals.
create or replace function public.remove_workspace_member(p_user_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  member_name text;
  company_ids uuid[];
  customer record;
  lead record;
  next_owner uuid;
  reassigned integer := 0;
  unassigned integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('filazoo_bd_lead_assignment'));
  if not exists(select 1 from public.workspace_members where user_id = p_actor_id and role = 'admin' and activated_at is not null) then
    raise exception 'Administrator access is required.';
  end if;
  if p_user_id = p_actor_id then
    raise exception 'You cannot delete your own administrator account.';
  end if;
  select display_name into member_name from public.workspace_members
    where user_id = p_user_id for update;
  if not found then raise exception 'The team member could not be found.'; end if;

  -- Capture the customers before deleting membership. Do not clear owners first:
  -- the sole-manager trigger would otherwise lose which customers need transfer.
  select array_agg(owned.company_id) into company_ids from (
    select company_id from public.pipeline where owner_id = p_user_id
    union select company_id from public.shopify_leads where owner_id = p_user_id and company_id is not null
    union select company_id from public.meta_leads where owner_id = p_user_id and company_id is not null
  ) owned;
  delete from public.workspace_members where user_id = p_user_id;

  -- Assign one customer at a time so the next choice includes the updated load.
  -- All sources for the same customer and their follow-up tasks stay together.
  for customer in select id from public.companies where id = any(company_ids) order by id for update loop
    select owner_id into next_owner from public.pipeline where company_id = customer.id for update;
    if next_owner is null or next_owner = p_user_id then
      next_owner := public.claim_next_bd_sales_manager();
      insert into public.pipeline(company_id, owner_id) values(customer.id, next_owner)
        on conflict(company_id) do update set owner_id = excluded.owner_id, updated_at = now();
    end if;
    update public.shopify_leads set owner_id = next_owner,
      assignment_method = case when next_owner is null then null else 'automatic' end,
      updated_at = now() where company_id = customer.id;
    update public.meta_leads set owner_id = next_owner,
      assignment_method = case when next_owner is null then null else 'automatic' end,
      updated_at = now() where company_id = customer.id;
    update public.crm_tasks set assigned_to = next_owner, updated_at = now()
      where company_id = customer.id and assigned_to = p_user_id;
    if next_owner is null then unassigned := unassigned + 1;
    else reassigned := reassigned + 1; end if;
    insert into public.events(company_id, actor_id, type, data)
      values(customer.id, p_actor_id, 'lead_owner_changed', jsonb_build_object(
        'previous_owner_id', p_user_id, 'owner_id', next_owner,
        'summary', case when next_owner is null then 'Customer returned to the unassigned queue after their member was removed.'
          else 'Customer automatically reassigned after their member was removed.' end));
  end loop;

  -- Older or still-processing source leads may not have a company yet.
  for lead in select webhook_id from public.shopify_leads where owner_id = p_user_id order by created_at, webhook_id for update loop
    next_owner := public.claim_next_bd_sales_manager();
    update public.shopify_leads set owner_id = next_owner,
      assignment_method = case when next_owner is null then null else 'automatic' end,
      updated_at = now() where webhook_id = lead.webhook_id;
    if next_owner is null then unassigned := unassigned + 1;
    else reassigned := reassigned + 1; end if;
  end loop;
  for lead in select leadgen_id from public.meta_leads where owner_id = p_user_id order by created_at, leadgen_id for update loop
    next_owner := public.claim_next_bd_sales_manager();
    update public.meta_leads set owner_id = next_owner,
      assignment_method = case when next_owner is null then null else 'automatic' end,
      updated_at = now() where leadgen_id = lead.leadgen_id;
    if next_owner is null then unassigned := unassigned + 1;
    else reassigned := reassigned + 1; end if;
  end loop;

  update public.crm_tasks task set assigned_to = (
    select owner_id from public.pipeline where company_id = task.company_id
  ), updated_at = now() where assigned_to = p_user_id;
  update public.flows set status = 'paused', updated_at = now() where user_id = p_user_id and status = 'live';
  update public.email_automation_settings set enabled = false, updated_at = now() where user_id = p_user_id;
  delete from public.workspace_mailboxes where user_id = p_user_id and type = 'personal';
  insert into public.events(actor_id, type, data) values(p_actor_id, 'workspace_member_deleted', jsonb_build_object(
    'target_user_id', p_user_id, 'reassigned', reassigned, 'unassigned', unassigned,
    'summary', coalesce(member_name, 'A member') || ' was removed from the workspace.'));
  return jsonb_build_object('reassigned', reassigned, 'unassigned', unassigned);
end;
$$;
revoke all on function public.remove_workspace_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_workspace_member(uuid, uuid) to service_role;

commit;
