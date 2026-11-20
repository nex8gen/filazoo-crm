begin;
set local lock_timeout='5s';
alter table public.crm_customer_tag_state add column updated_at timestamptz not null default now();
create index crm_customer_tag_state_freshness on public.crm_customer_tag_state(workspace_id,updated_at desc);
create function public.touch_customer_tag_state() returns trigger
language plpgsql security invoker set search_path='' as $$
begin new.updated_at:=clock_timestamp(); return new; end $$;
create trigger customer_tag_state_updated before update on public.crm_customer_tag_state
  for each row execute function public.touch_customer_tag_state();
revoke all on function public.touch_customer_tag_state() from public,anon,authenticated;
grant execute on function public.touch_customer_tag_state() to service_role,crm_workspace_server;
notify pgrst,'reload schema';
commit;
