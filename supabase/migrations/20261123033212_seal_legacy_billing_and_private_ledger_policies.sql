begin;
-- Old deployment/action replays may renew a genuine legacy contract, but may
-- not onboard new customers at retired prices. Commercial provisioning calls
-- the private verified helper directly, then converts its new order to v2.
alter function public.create_subscription_order(uuid,uuid,text,text,text) set schema crm_billing;
alter function crm_billing.create_subscription_order(uuid,uuid,text,text,text) rename to create_legacy_subscription_order;
create function public.create_subscription_order(p_user_id uuid,p_workspace_id uuid,p_name text,p_plan_id text,p_out_trade_no text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if p_workspace_id is null or not exists(select 1 from public.subscription_orders where workspace_id=p_workspace_id and kind='subscription' and catalog_version=1 and status='paid' and plan_id=p_plan_id)
 then raise exception 'Legacy plans are available only for renewal'; end if;
 return crm_billing.create_legacy_subscription_order(p_user_id,p_workspace_id,p_name,p_plan_id,p_out_trade_no);
end $$;
do $$ declare source text; updated text; begin
 select pg_get_functiondef('public.create_commercial_order(uuid,uuid,text,text,integer,text,text)'::regprocedure) into source;
 updated:=replace(source,'public.create_subscription_order(', 'crm_billing.create_legacy_subscription_order(');
 if updated=source then raise exception 'Review commercial workspace provisioning'; end if;
 execute updated;
end $$;
revoke all on function public.create_subscription_order(uuid,uuid,text,text,text),crm_billing.create_legacy_subscription_order(uuid,uuid,text,text,text) from public,anon,authenticated,crm_workspace_server;
grant execute on function public.create_subscription_order(uuid,uuid,text,text,text),crm_billing.create_legacy_subscription_order(uuid,uuid,text,text,text) to service_role;
-- Explicit policies document the deliberate server-only access model.
create policy billing_service_only on crm_billing.plan_catalog for all to service_role using(true) with check(true);
create policy billing_service_only on crm_billing.credit_grants for all to service_role using(true) with check(true);
create policy billing_service_only on crm_billing.credit_allocations for all to service_role using(true) with check(true);
create policy billing_service_only on crm_billing.monthly_usage for all to service_role using(true) with check(true);
notify pgrst,'reload schema';
commit;
