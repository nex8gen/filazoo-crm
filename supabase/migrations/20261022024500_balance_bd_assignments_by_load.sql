begin;

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

commit;
