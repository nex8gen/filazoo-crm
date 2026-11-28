begin;
set local lock_timeout='5s';

-- Rates are private, short-lived, and immutable once quoted. Existing paid and
-- pending catalog v1-v4 orders keep their original contract and price.
create table crm_billing.credit_recharge_pricing (
 id uuid primary key default gen_random_uuid(),
 base_rate_micros bigint not null check(base_rate_micros between 1000000 and 50000000),
 rate_micros bigint generated always as (ceil(base_rate_micros::numeric*102/100)::bigint) stored,
 source_date date not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '1 hour',
 unique(id,rate_micros), check(expires_at>created_at)
);
create index credit_recharge_pricing_lookup on crm_billing.credit_recharge_pricing(source_date,base_rate_micros,expires_at desc);
alter table crm_billing.credit_recharge_pricing enable row level security;
revoke all on crm_billing.credit_recharge_pricing from public,anon,authenticated,crm_workspace_server;
grant select,insert on crm_billing.credit_recharge_pricing to service_role;

alter table public.subscription_orders
 add column credit_quantity bigint,
 add column credit_rate_micros bigint,
 add column credit_pricing_id uuid,
 add constraint subscription_credit_pricing_fk foreign key(credit_pricing_id,credit_rate_micros) references crm_billing.credit_recharge_pricing(id,rate_micros),
 add constraint subscription_credit_metadata check (
  (catalog_version=5 and credit_quantity is not null and credit_rate_micros is not null and credit_pricing_id is not null)
  or (catalog_version<>5 and credit_quantity is null and credit_rate_micros is null and credit_pricing_id is null)
 );

do $$ declare previous_rule text; begin
 select pg_get_expr(conbin,conrelid) into strict previous_rule from pg_constraint
  where conrelid='public.subscription_orders'::regclass and conname='subscription_catalog_price';
 alter table public.subscription_orders drop constraint subscription_catalog_price;
 execute 'alter table public.subscription_orders add constraint subscription_catalog_price check (coalesce(('||previous_rule||'),false) or coalesce((
  catalog_version=5 and kind=''credits'' and plan_id=''credits_custom'' and seats=1 and period_months=1
  and credit_quantity>0 and credit_rate_micros between 1000000 and 51000000
  and amount_fen>0 and amount_fen=ceil(credit_quantity::numeric*credit_rate_micros/10000000)
 ),false))';
end $$;

create function crm_billing.freeze_credit_recharge_order() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.catalog_version=5 and row(new.catalog_version,new.kind,new.plan_id,new.workspace_id,new.user_id,new.amount_fen,new.currency,new.seats,new.period_months,new.credit_quantity,new.credit_rate_micros,new.credit_pricing_id,new.out_trade_no,new.expires_at)
  is distinct from row(old.catalog_version,old.kind,old.plan_id,old.workspace_id,old.user_id,old.amount_fen,old.currency,old.seats,old.period_months,old.credit_quantity,old.credit_rate_micros,old.credit_pricing_id,old.out_trade_no,old.expires_at)
 then raise exception 'Credit recharge quote is immutable'; end if;
 return new;
end $$;
revoke all on function crm_billing.freeze_credit_recharge_order() from public,anon,authenticated,crm_workspace_server;
create trigger freeze_credit_recharge_order before update on public.subscription_orders for each row execute function crm_billing.freeze_credit_recharge_order();

create function public.prepare_credit_recharge_pricing(p_base_rate_micros bigint,p_source_date date) returns jsonb
language plpgsql set search_path='' set timezone='UTC' as $$
declare price crm_billing.credit_recharge_pricing;
begin
 if p_base_rate_micros is null or p_base_rate_micros not between 1000000 and 50000000
  or p_source_date is null or p_source_date>current_date or p_source_date<current_date-7
 then raise exception 'Pricing is temporarily unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended('credit-recharge-pricing',1));
 select * into price from crm_billing.credit_recharge_pricing where base_rate_micros=p_base_rate_micros and source_date=p_source_date
  and expires_at>now()+interval '5 minutes' order by expires_at desc limit 1;
 if not found then
  insert into crm_billing.credit_recharge_pricing(base_rate_micros,source_date) values(p_base_rate_micros,p_source_date) returning * into price;
 end if;
 return jsonb_build_object('id',price.id,'rateMicros',price.rate_micros,'expiresAt',price.expires_at);
end $$;
revoke all on function public.prepare_credit_recharge_pricing(bigint,date) from public,anon,authenticated,crm_workspace_server;
grant execute on function public.prepare_credit_recharge_pricing(bigint,date) to service_role;

create function public.create_credit_recharge_order(p_user_id uuid,p_workspace_id uuid,p_pricing_id uuid,p_credits bigint,p_expected_amount_fen integer,p_out_trade_no text) returns jsonb
language plpgsql set search_path='' as $$
declare price crm_billing.credit_recharge_pricing; total numeric; o public.subscription_orders;
begin
 if p_credits is null or p_credits<=0 then raise exception 'Enter a valid credit amount'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,1));
 if not exists(select 1 from public.workspaces w join public.workspace_members m on m.workspace_id=w.id
  where w.id=p_workspace_id and w.owner_id=p_user_id and m.user_id=p_user_id and m.activated_at is not null)
 then raise insufficient_privilege using message='Only the workspace owner can recharge credits'; end if;
 if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null) then raise exception 'Verify your email before recharging'; end if;
 if not coalesce(crm_billing.has_access(p_workspace_id),false) then raise exception 'An active subscription is required'; end if;
 select * into price from crm_billing.credit_recharge_pricing where id=p_pricing_id and expires_at>now();
 if not found then raise exception 'Refresh pricing before recharging'; end if;
 total:=ceil(p_credits::numeric*price.rate_micros/10000000);
 if total>2147483647 then raise exception 'This amount exceeds the per-payment limit. Split it into separate recharges'; end if;
 if total is distinct from p_expected_amount_fen::numeric then raise exception 'Recharge total changed. Refresh pricing and try again'; end if;
 select * into o from public.subscription_orders where workspace_id=p_workspace_id and user_id=p_user_id and status='pending' and expires_at>now()
  and catalog_version=5 and credit_quantity=p_credits and credit_rate_micros=price.rate_micros and amount_fen=total::integer order by created_at desc limit 1;
 if found then return to_jsonb(o); end if;
 if exists(select 1 from public.subscription_orders where workspace_id=p_workspace_id and status='pending' and expires_at>now()) then raise exception 'Finish the existing checkout or wait for it to expire before changing plans'; end if;
 if (select count(*) from public.subscription_orders where user_id=p_user_id and created_at>now()-interval '15 minutes')>=6 then raise exception 'Too many checkout attempts. Please try again later'; end if;
 insert into public.subscription_orders(workspace_id,user_id,out_trade_no,catalog_version,kind,plan_id,seats,amount_fen,period_months,credit_quantity,credit_rate_micros,credit_pricing_id)
  values(p_workspace_id,p_user_id,p_out_trade_no,5,'credits','credits_custom',1,total::integer,1,p_credits,price.rate_micros,price.id) returning * into o;
 return to_jsonb(o);
end $$;
revoke all on function public.create_credit_recharge_order(uuid,uuid,uuid,bigint,integer,text) from public,anon,authenticated,crm_workspace_server;
grant execute on function public.create_credit_recharge_order(uuid,uuid,uuid,bigint,integer,text) to service_role;

-- Keep the existing signed-payment, refund and replay checks. Only the number
-- of credited units changes for newly versioned custom recharge orders.
do $$ declare source text; updated text; begin
 select pg_get_functiondef('public.confirm_subscription_payment(text,text,integer,text)'::regprocedure) into source;
 updated:=replace(source,'''topup'',3000000,start_at',
  '''topup'',case when o.catalog_version=5 then o.credit_quantity*1000 else 3000000 end,start_at');
 if updated=source then raise exception 'Review credit settlement before rollout'; end if;
 execute updated;
end $$;
notify pgrst,'reload schema';
commit;
