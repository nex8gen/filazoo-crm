begin;
set local lock_timeout='5s';

-- Private, account-bound, single-use subscription codes. Store hashes only.
create table crm_billing.subscription_discounts (
 id uuid primary key default gen_random_uuid(),
 code_hash text not null unique check(code_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid not null references auth.users(id),
 discount_percent integer not null default 100 check(discount_percent=100),
 expires_at timestamptz not null default now()+interval '30 days',
 revoked_at timestamptz,
 redeemed_order_id uuid unique references public.subscription_orders(id),
 created_at timestamptz not null default now(),
 check(expires_at>created_at)
);
create index subscription_discounts_user on crm_billing.subscription_discounts(user_id);
alter table crm_billing.subscription_discounts enable row level security;
revoke all on crm_billing.subscription_discounts from public,anon,authenticated,crm_workspace_server;
grant select,insert,update on crm_billing.subscription_discounts to service_role;
create policy subscription_discounts_service on crm_billing.subscription_discounts for all to service_role using(true) with check(true);

alter table public.subscription_orders
 add column subscription_discount_id uuid unique references crm_billing.subscription_discounts(id),
 add column discount_amount_fen integer not null default 0,
 add constraint subscription_discount_metadata check (
  (subscription_discount_id is null and discount_amount_fen=0)
  or (subscription_discount_id is not null and catalog_version=4 and kind='subscription'
   and amount_fen=0 and discount_amount_fen>0 and status='paid' and alipay_trade_no is null)
 );

-- Preserve every frozen catalog's price checks against the gross price. Only
-- an audited, fully discounted v4 subscription can have a zero net amount.
do $$ declare previous_rule text; begin
 select pg_get_expr(conbin,conrelid) into strict previous_rule from pg_constraint
  where conrelid='public.subscription_orders'::regclass and conname='subscription_catalog_price';
 alter table public.subscription_orders drop constraint subscription_catalog_price;
 execute 'alter table public.subscription_orders add constraint subscription_catalog_price check ('||replace(previous_rule,'amount_fen','(amount_fen + discount_amount_fen)')||')';
end $$;
alter table public.subscription_orders drop constraint subscription_orders_check1;
alter table public.subscription_orders add constraint subscription_orders_check1 check (
 status<>'paid' or ((alipay_trade_no is not null or subscription_discount_id is not null)
  and period_start is not null and period_end>period_start)
);

create function public.check_subscription_discount(p_user_id uuid,p_workspace_id uuid,p_code_hash text) returns jsonb
language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from crm_tenancy.verified_user(p_user_id))
  or not exists(select 1 from crm_billing.subscription_discounts where code_hash=p_code_hash and user_id=p_user_id
   and revoked_at is null and expires_at>now() and redeemed_order_id is null)
 then raise exception 'This discount code is not available for your account'; end if;
 if p_workspace_id is not null and not exists(select 1 from public.workspaces w join public.workspace_members m on m.workspace_id=w.id
  where w.id=p_workspace_id and w.owner_id=p_user_id and m.user_id=p_user_id and m.role='admin' and m.activated_at is not null)
 then raise insufficient_privilege using message='Only the workspace owner can subscribe'; end if;
 return jsonb_build_object('discountPercent',100);
end $$;

create function public.redeem_subscription_discount(p_user_id uuid,p_workspace_id uuid,p_name text,p_plan_id text,p_period_months integer,p_out_trade_no text,p_code_hash text) returns jsonb
language plpgsql set search_path='' as $$
declare d crm_billing.subscription_discounts; o public.subscription_orders; package jsonb; seed jsonb; start_at timestamptz; first_commercial boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 if not exists(select 1 from crm_tenancy.verified_user(p_user_id)) then raise exception 'Verify your email before subscribing'; end if;
 select * into d from crm_billing.subscription_discounts where code_hash=p_code_hash and user_id=p_user_id for update;
 if not found or d.revoked_at is not null then raise exception 'This discount code is not available for your account'; end if;
 -- Repeated checkout submissions return the same grant, never another period.
 if d.redeemed_order_id is not null then
  select x.* into o from public.subscription_orders x join public.workspaces w on w.id=x.workspace_id
   join public.workspace_members m on m.workspace_id=w.id and m.user_id=p_user_id
   where x.id=d.redeemed_order_id and x.user_id=p_user_id and w.owner_id=p_user_id and m.role='admin' and m.activated_at is not null;
  if not found or o.status<>'paid' or o.plan_id is distinct from p_plan_id or o.period_months is distinct from p_period_months
   or (p_workspace_id is not null and o.workspace_id<>p_workspace_id)
  then raise exception 'This discount code has already been used'; end if;
  return to_jsonb(o);
 end if;
 perform public.check_subscription_discount(p_user_id,p_workspace_id,p_code_hash);
 package:=crm_billing.package_catalog_v4(p_plan_id);
 if package is null or p_period_months is null or p_period_months not in (1,12) then raise exception 'Choose a valid workspace package'; end if;
 -- Reuse existing ownership, capacity, renewal, pending order and rate checks.
 seed:=public.create_package_subscription_order(p_user_id,p_workspace_id,p_name,p_plan_id,(package->>'seats')::integer,'subscription',p_out_trade_no,p_period_months);
 select * into strict o from public.subscription_orders where id=(seed->>'id')::uuid for update;
 if o.out_trade_no is distinct from p_out_trade_no then raise exception 'Finish the existing checkout or wait for it to expire before changing plans'; end if;
 if o.status<>'pending' or o.subscription_discount_id is not null then raise exception 'Order is no longer payable'; end if;
 first_commercial:=not exists(select 1 from public.subscription_orders where workspace_id=o.workspace_id and status='paid' and kind='subscription' and catalog_version>=2);
 select greatest(now(),coalesce(max(period_end),now())) into start_at from public.subscription_orders where workspace_id=o.workspace_id and status='paid' and kind='subscription';
 update public.subscription_orders set discount_amount_fen=amount_fen,amount_fen=0,subscription_discount_id=d.id,status='paid',
  paid_at=now(),period_start=start_at,period_end=start_at+make_interval(months=>o.period_months) where id=o.id returning * into o;
 update crm_billing.subscription_discounts set redeemed_order_id=o.id where id=d.id;
 if first_commercial then update public.ai_budget_policy set monthly_micros=1000000000000,daily_micros=1000000000000,minimum_shares=1 where workspace_id=o.workspace_id; end if;
 update public.ai_budget_policy set credit_only=true where workspace_id=o.workspace_id;
 perform crm_billing.sync_included_credits(o.workspace_id);
 return to_jsonb(o);
end $$;

revoke all on function public.check_subscription_discount(uuid,uuid,text),public.redeem_subscription_discount(uuid,uuid,text,text,integer,text,text) from public,anon,authenticated,crm_workspace_server;
grant execute on function public.check_subscription_discount(uuid,uuid,text),public.redeem_subscription_discount(uuid,uuid,text,text,integer,text,text) to service_role;
notify pgrst,'reload schema';
commit;
