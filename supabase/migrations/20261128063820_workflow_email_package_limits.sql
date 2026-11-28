begin;
set local lock_timeout='5s';

create function crm_billing.package_catalog_v6(p_plan_id text) returns jsonb
language sql immutable set search_path='' as $$
 select case p_plan_id
 when 'starter' then jsonb_build_object('seats',1,'credits',2000,'monthlyFen',13900,'annualFen',130800,'limits',jsonb_build_object('companies',1000,'products',100,'mailboxes',1,'flows',5,'workflowEmails',1000,'documentBytes',1000000000))
 when 'pro' then jsonb_build_object('seats',2,'credits',6000,'monthlyFen',42900,'annualFen',430800,'limits',jsonb_build_object('companies',5000,'products',500,'mailboxes',3,'flows',15,'workflowEmails',5000,'documentBytes',5000000000))
 when 'business' then jsonb_build_object('seats',5,'credits',15000,'monthlyFen',92900,'annualFen',934800,'limits',jsonb_build_object('companies',20000,'products',2000,'mailboxes',5,'flows',50,'workflowEmails',20000,'documentBytes',20000000000))
 end;
$$;
revoke all on function crm_billing.package_catalog_v6(text) from public,anon,authenticated,crm_workspace_server;
grant execute on function crm_billing.package_catalog_v6(text) to service_role;

-- Keep old catalog data and quoted orders immutable. V6 has the same prices
-- and included seats as V4, with independently versioned resource allowances.
do $$ declare previous_rule text; updated text; begin
 select pg_get_expr(conbin,conrelid) into strict previous_rule from pg_constraint
 where conrelid='public.subscription_orders'::regclass and conname='subscription_catalog_price';
 updated:=replace(previous_rule,'(catalog_version = 4)','(catalog_version in (4,6))');
 if updated=previous_rule then raise exception 'Review frozen catalog checks before rollout'; end if;
 alter table public.subscription_orders drop constraint subscription_catalog_price;
 execute 'alter table public.subscription_orders add constraint subscription_catalog_price check ('||updated||')';
end $$;
alter table public.subscription_orders drop constraint subscription_period_catalog;
alter table public.subscription_orders add constraint subscription_period_catalog check(catalog_version in (3,4,6) or period_months=1);
alter table public.subscription_orders drop constraint subscription_discount_metadata;
alter table public.subscription_orders add constraint subscription_discount_metadata check (
 (subscription_discount_id is null and discount_amount_fen=0)
 or (subscription_discount_id is not null and catalog_version in (4,6) and kind='subscription'
  and amount_fen=0 and discount_amount_fen>0 and status='paid' and alipay_trade_no is null)
);

do $$ declare source text; updated text; begin
 select pg_get_functiondef('public.create_package_subscription_order(uuid,uuid,text,text,integer,text,text,integer)'::regprocedure) into source;
 updated:=replace(source,'public.create_package_subscription_order','public.create_current_package_subscription_order');
 updated:=replace(updated,'crm_billing.package_catalog_v4','crm_billing.package_catalog_v6');
 updated:=replace(updated,'catalog_version=4','catalog_version=6');
 updated:=replace(updated,'''catalogVersion'' is distinct from ''4''','''catalogVersion'' is distinct from ''6''');
 updated:=replace(updated,'p_out_trade_no,4,p_kind','p_out_trade_no,6,p_kind');
 if updated=source then raise exception 'Review current package creation before rollout'; end if;
 execute updated;

 select pg_get_functiondef('crm_billing.entitlement_before_complimentary(uuid)'::regprocedure) into source;
 updated:=replace(source,'if o.catalog_version=4 then','if o.catalog_version in (4,6) then');
 updated:=replace(updated,'package:=crm_billing.package_catalog_v4(o.plan_id);','package:=case when o.catalog_version=6 then crm_billing.package_catalog_v6(o.plan_id) else crm_billing.package_catalog_v4(o.plan_id) end;');
 updated:=replace(updated,'''catalogVersion'',4,','''catalogVersion'',o.catalog_version,');
 if updated=source then raise exception 'Review package entitlements before rollout'; end if;
 execute updated;

 select pg_get_functiondef('crm_billing.sync_credits_before_complimentary(uuid)'::regprocedure) into source;
 updated:=replace(source,'e->>''catalogVersion''=''4''','e->>''catalogVersion'' in (''4'',''6'')');
 if updated=source then raise exception 'Review package credit multiplier before rollout'; end if;
 execute updated;

 select pg_get_functiondef('public.confirm_subscription_payment(text,text,integer,text)'::regprocedure) into source;
 updated:=replace(source,'if o.catalog_version=4 then','if o.catalog_version in (4,6) then');
 if updated=source then raise exception 'Review credit-only package settlement before rollout'; end if;
 execute updated;

 select pg_get_functiondef('public.redeem_subscription_discount(uuid,uuid,text,text,integer,text,text)'::regprocedure) into source;
 updated:=replace(source,'crm_billing.package_catalog_v4','crm_billing.package_catalog_v6');
 updated:=replace(updated,'public.create_package_subscription_order','public.create_current_package_subscription_order');
 if updated=source then raise exception 'Review package discount redemption before rollout'; end if;
 execute updated;
end $$;
revoke all on function public.create_current_package_subscription_order(uuid,uuid,text,text,integer,text,text,integer) from public,anon,authenticated,crm_workspace_server;
grant execute on function public.create_current_package_subscription_order(uuid,uuid,text,text,integer,text,text,integer) to service_role;

-- Workflow starts are no longer a commercial meter. Historical counters are
-- retained for audit, but starting or retrying a run does not spend an email.
drop trigger enforce_monthly_flow_runs on public.flow_runs;

create table crm_billing.workflow_email_deliveries (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 -- Retain usage even when old run histories are deleted.
 run_id uuid not null,
 step_id text not null check(length(step_id) between 1 and 100),
 period_start date not null,
 state text not null check(state in ('reserved','sent','released','uncertain')),
 reserved_at timestamptz not null default now(),
 sent_at timestamptz,
 unique(workspace_id,run_id,step_id),
 check((state='sent')=(sent_at is not null))
);
create index workflow_email_deliveries_month on crm_billing.workflow_email_deliveries(workspace_id,period_start,state);
alter table crm_billing.workflow_email_deliveries enable row level security;
revoke all on crm_billing.workflow_email_deliveries from public,anon,authenticated,crm_workspace_server;
grant select,insert,update on crm_billing.workflow_email_deliveries to service_role;
create policy workflow_email_deliveries_service on crm_billing.workflow_email_deliveries for all to service_role using(true) with check(true);

create function public.reserve_workflow_email(p_run_id uuid,p_step_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w uuid:=crm_tenancy.workspace_id(); d crm_billing.workflow_email_deliveries; cap bigint; used bigint;
 period date:=date_trunc('month',now() at time zone 'Asia/Shanghai')::date;
begin
 if p_step_id is null or length(p_step_id) not between 1 and 100 then raise exception 'Invalid workflow email action'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text,1));
 if not exists(select 1 from public.flow_runs where workspace_id=w and id=p_run_id and status='active'
  and context#>>'{executionCheckpoint,stepId}'=p_step_id
  and context#>>'{executionCheckpoint,type}' in ('send_email','ai_auto_reply'))
 then raise insufficient_privilege using message='Workflow email action is not available in this workspace'; end if;
 if not coalesce(crm_billing.has_access(w),false) then raise exception 'An active subscription is required'; end if;
 select * into d from crm_billing.workflow_email_deliveries where workspace_id=w and run_id=p_run_id and step_id=p_step_id;
 if found and d.state<>'released' then return jsonb_build_object('state',case when d.state='reserved' then 'pending' else d.state end); end if;
 cap:=(crm_billing.entitlement(w)#>>'{limits,workflowEmails}')::bigint;
 select count(*) into used from crm_billing.workflow_email_deliveries where workspace_id=w and period_start=period and state in ('reserved','sent','uncertain');
 if cap is not null and used>=cap then return jsonb_build_object('state','limited','resetsAt',(period+interval '1 month') at time zone 'Asia/Shanghai'); end if;
 insert into crm_billing.workflow_email_deliveries(workspace_id,run_id,step_id,period_start,state)
 values(w,p_run_id,p_step_id,period,'reserved') on conflict(workspace_id,run_id,step_id) do update
 set period_start=excluded.period_start,state='reserved',reserved_at=now(),sent_at=null;
 return jsonb_build_object('state','reserved');
end $$;

create function public.finish_workflow_email(p_run_id uuid,p_step_id text,p_outcome text) returns void
language plpgsql security definer set search_path='' as $$
declare w uuid:=crm_tenancy.workspace_id(); d crm_billing.workflow_email_deliveries;
begin
 if p_outcome is null or p_outcome not in ('sent','released','uncertain') then raise exception 'Invalid workflow email outcome'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text,1));
 select * into d from crm_billing.workflow_email_deliveries where workspace_id=w and run_id=p_run_id and step_id=p_step_id for update;
 if not found then raise insufficient_privilege using message='Workflow email reservation is not available in this workspace'; end if;
 if d.state=p_outcome then return; end if;
 if d.state='sent' or d.state='released' or (d.state='uncertain' and p_outcome='released') then raise exception 'Workflow email outcome cannot be reversed'; end if;
 update crm_billing.workflow_email_deliveries set state=p_outcome,sent_at=case when p_outcome='sent' then now() else null end where id=d.id;
end $$;
revoke all on function public.reserve_workflow_email(uuid,text),public.finish_workflow_email(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_workflow_email(uuid,text),public.finish_workflow_email(uuid,text,text) to service_role,crm_workspace_server;

do $$ declare source text; updated text; begin
 select pg_get_functiondef('crm_billing.billing_overview(uuid)'::regprocedure) into source;
 updated:=replace(source,'''flowRuns'',coalesce((select flow_runs from crm_billing.monthly_usage where workspace_id=w and period_start=date_trunc(''month'',now() at time zone ''Asia/Shanghai'')::date),0)',
  '''workflowEmails'',(select count(*) from crm_billing.workflow_email_deliveries where workspace_id=w and period_start=date_trunc(''month'',now() at time zone ''Asia/Shanghai'')::date and state=''sent'')');
 if updated=source then raise exception 'Review workflow email usage reporting before rollout'; end if;
 execute updated;
end $$;
notify pgrst,'reload schema';
commit;
