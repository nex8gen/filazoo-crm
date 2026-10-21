begin;

alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check
  check (role in ('admin','operator','bd_manager','viewer'));
alter table public.workspace_members
  add column if not exists auto_assign_leads boolean not null default false,
  add column if not exists last_lead_assigned_at timestamptz;
update public.workspace_members set auto_assign_leads = true where role = 'bd_manager';

alter table public.meta_leads
  add column if not exists owner_id uuid references auth.users(id) on delete set null,
  add column if not exists assignment_method text check (assignment_method is null or assignment_method in ('automatic','manual'));
alter table public.shopify_leads
  add column if not exists owner_id uuid references auth.users(id) on delete set null,
  add column if not exists assignment_method text check (assignment_method is null or assignment_method in ('automatic','manual'));

create index if not exists workspace_members_auto_assignment_idx on public.workspace_members(role,auto_assign_leads,last_lead_assigned_at);
create index if not exists meta_leads_owner_id_idx on public.meta_leads(owner_id);
create index if not exists shopify_leads_owner_id_idx on public.shopify_leads(owner_id);

create or replace function public.claim_next_bd_sales_manager() returns uuid
language plpgsql security invoker set search_path = public as $$
declare selected_user_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('filazoo_bd_lead_assignment'));
  select member.user_id into selected_user_id
  from public.workspace_members member
  join auth.users account on account.id = member.user_id
  where member.role = 'bd_manager' and member.auto_assign_leads = true and account.email_confirmed_at is not null
  order by member.last_lead_assigned_at asc nulls first, member.created_at asc, member.user_id asc
  limit 1 for update;
  if selected_user_id is not null then
    update public.workspace_members set last_lead_assigned_at = clock_timestamp() where user_id = selected_user_id;
  end if;
  return selected_user_id;
end;
$$;

revoke all on function public.claim_next_bd_sales_manager() from public, anon, authenticated;
grant execute on function public.claim_next_bd_sales_manager() to service_role;
commit;
