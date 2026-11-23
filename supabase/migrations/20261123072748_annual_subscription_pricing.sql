-- Catalog v3: annual keeps the prior monthly equivalent; monthly costs 20% more.
-- Existing orders retain their original price and period.
begin;
set local lock_timeout='5s';
alter table public.subscription_orders add column period_months integer not null default 1 check(period_months in (1,12));
alter table public.subscription_orders add constraint subscription_period_catalog check(catalog_version=3 or period_months=1);
alter table public.subscription_orders drop constraint subscription_catalog_price;
alter table public.subscription_orders add constraint subscription_catalog_price check (
 (catalog_version=1 and kind='subscription' and ((plan_id='starter' and amount_fen=9900) or (plan_id='team' and amount_fen=29900))) or
 (catalog_version=2 and ((kind='subscription' and ((plan_id='starter' and amount_fen=13900*seats) or (plan_id='pro' and amount_fen=27900*seats) or (plan_id='business' and amount_fen=55900*seats))) or
 (kind='credits' and plan_id='credits_3000' and amount_fen=6900 and seats=1))) or
 (catalog_version=3 and kind='subscription' and amount_fen=seats*(case plan_id when 'starter' then 13900 when 'pro' then 27900 when 'business' then 55900 else -1 end)*(case when period_months=12 then 12 else 1.2 end) and plan_id in ('starter','pro','business'))
);
create function public.create_period_subscription_order(p_user_id uuid,p_workspace_id uuid,p_name text,p_plan_id text,p_seats integer,p_kind text,p_out_trade_no text,p_period_months integer) returns jsonb
language plpgsql set search_path='' as $$
declare w uuid:=p_workspace_id; o public.subscription_orders; e jsonb; price integer; seed jsonb;
begin
 if p_period_months is null or p_period_months not in (1,12) or p_kind is distinct from 'subscription' or p_seats is null or p_seats not between 1 and 100 then raise exception 'Choose a valid plan and seat count'; end if;
 if p_kind='subscription' then select cny_fen*p_seats*(case when p_period_months=12 then 12 else 1.2 end)::numeric into price from crm_billing.plan_catalog where id=p_plan_id;
 else if p_plan_id='credits_3000' and p_seats=1 then price:=6900; end if; end if;
 if price is null then raise exception 'Choose a valid plan'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 if w is null then
  select x.id into w from public.workspaces x join public.workspace_subscriptions s on s.workspace_id=x.id
   where x.owner_id=p_user_id and not s.grandfathered and not exists(select 1 from public.subscription_orders z where z.workspace_id=x.id and z.status='paid')
   order by x.created_at desc limit 1;
 end if;
 -- Reuse verified provisioning without changing the old two-plan checkout API.
 if w is null then
  if p_kind<>'subscription' then raise exception 'Choose an active workspace'; end if;
  seed:=crm_billing.create_legacy_subscription_order(p_user_id,null,p_name,'starter',p_out_trade_no);
  w:=(seed->>'workspace_id')::uuid;
  update public.subscription_orders set catalog_version=3,period_months=p_period_months,plan_id=p_plan_id,seats=p_seats,amount_fen=price where id=(seed->>'id')::uuid and status='pending';
  select * into o from public.subscription_orders where id=(seed->>'id')::uuid;
  return to_jsonb(o);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text,1));
 if not exists(select 1 from public.workspaces x join public.workspace_members m on m.workspace_id=x.id where x.id=w and x.owner_id=p_user_id and m.user_id=p_user_id and m.activated_at is not null) then raise insufficient_privilege using message='Only the workspace owner can subscribe'; end if;
 e:=crm_billing.entitlement(w);
 if coalesce((e->>'complimentary')::boolean,false) then raise exception 'This workspace has a complimentary subscription. No payment is required'; end if;
 if p_kind='credits' and not (e->>'active')::boolean then raise exception 'An active subscription is required'; end if;
 if p_kind='subscription' then
  if coalesce((e->>'grandfathered')::boolean,false) then raise exception 'Your beta workspace already has access'; end if;
  if (e->>'active')::boolean and (coalesce((e->>'legacy')::boolean,false) or e->>'plan'<>p_plan_id or (e->>'seats')::integer<>p_seats) then raise exception 'Renew the current plan and seats, or change them after expiry'; end if;
  if (select count(*) from public.workspace_members where workspace_id=w)>p_seats then raise exception 'This plan cannot hold your current team'; end if;
 end if;
 select * into o from public.subscription_orders where workspace_id=w and user_id=p_user_id and status='pending' and expires_at>now() and catalog_version=3 and period_months=p_period_months and plan_id=p_plan_id and seats=p_seats and kind=p_kind order by created_at desc limit 1;
 if found then return to_jsonb(o); end if;
 if exists(select 1 from public.subscription_orders where workspace_id=w and status='pending' and expires_at>now()) then raise exception 'Finish the existing checkout or wait for it to expire before changing plans'; end if;
 if (select count(*) from public.subscription_orders where user_id=p_user_id and created_at>now()-interval '15 minutes')>=6 then raise exception 'Too many checkout attempts. Please try again later'; end if;
 insert into public.subscription_orders(workspace_id,user_id,out_trade_no,catalog_version,kind,plan_id,seats,amount_fen,period_months) values(w,p_user_id,p_out_trade_no,3,p_kind,p_plan_id,p_seats,price,p_period_months) returning * into o;
 return to_jsonb(o);
end $$;


create or replace function crm_billing.entitlement_before_complimentary(w uuid) returns jsonb
language plpgsql stable security definer set search_path='' set timezone='Asia/Shanghai' as $$
declare o public.subscription_orders; p crm_billing.plan_catalog; beta boolean; month_index integer:=0; credit_start timestamptz; credit_end timestamptz;
begin
 select grandfathered into beta from public.workspace_subscriptions where workspace_id=w;
 select * into o from public.subscription_orders where workspace_id=w and kind='subscription' and status='paid' and period_start<=now() and period_end>now() order by period_start desc limit 1;
 if not found then return jsonb_build_object('plan',case when beta then 'beta' else 'inactive' end,'grandfathered',coalesce(beta,false),'active',coalesce(beta,false),'seats',0); end if;
 if o.catalog_version=1 then return jsonb_build_object('plan',o.plan_id,'legacy',true,'active',true,'grandfathered',false,'seats',case when o.plan_id='team' then 5 else 1 end,'orderId',o.id,'startsAt',o.period_start,'resetsAt',o.period_end); end if;
 select * into strict p from crm_billing.plan_catalog where id=o.plan_id;
 credit_start:=o.period_start; credit_end:=o.period_end;
 if o.period_months=12 then
  select i into month_index from generate_series(0,11) i where o.period_start+make_interval(months=>i)<=now() order by i desc limit 1;
  credit_start:=o.period_start+make_interval(months=>month_index);
  credit_end:=least(o.period_end,o.period_start+make_interval(months=>month_index+1));
 end if;
 return to_jsonb(p)||jsonb_build_object('plan',o.plan_id,'active',true,'grandfathered',false,'seats',o.seats,'orderId',o.id,'startsAt',credit_start,'resetsAt',credit_end,'periodMonths',o.period_months,'subscriptionStartsAt',o.period_start,'paidUntil',o.period_end,
  'limits',jsonb_build_object('companies',p.companies*o.seats,'products',p.products*o.seats,'mailboxes',p.mailboxes*o.seats,'flows',p.flows*o.seats,'flowRuns',p.flow_runs*o.seats,'documentBytes',p.document_bytes*o.seats));
end $$;


create or replace function crm_billing.sync_credits_before_complimentary(w uuid) returns void
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare e jsonb; start_at timestamptz; end_at timestamptz; amount bigint; source_id text;
begin
 perform pg_advisory_xact_lock(hashtextextended(w::text,1));
 e:=crm_billing.entitlement(w);
 if not (e->>'active')::boolean then return; end if;
 if e->>'periodMonths'='12' then
  insert into crm_billing.credit_grants(workspace_id,source,kind,amount_micros,starts_at,expires_at)
  select w,'order:'||(e->>'orderId')||':month:'||i,'included',(e->>'credits')::bigint*1000*(e->>'seats')::integer,
   (((e->>'subscriptionStartsAt')::timestamptz at time zone 'Asia/Shanghai')+make_interval(months=>i)) at time zone 'Asia/Shanghai',
   least((e->>'paidUntil')::timestamptz,(((e->>'subscriptionStartsAt')::timestamptz at time zone 'Asia/Shanghai')+make_interval(months=>i+1)) at time zone 'Asia/Shanghai')
  from generate_series(0,11) i on conflict(workspace_id,source) do nothing;
  return;
 end if;
 if e->>'plan'='beta' then
  start_at:=date_trunc('month',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai';
  end_at:=(date_trunc('month',now() at time zone 'Asia/Shanghai')+interval '1 month') at time zone 'Asia/Shanghai';
  amount:=10000000; source_id:='beta:'||start_at::text;
 else
  start_at:=(e->>'startsAt')::timestamptz; end_at:=(e->>'resetsAt')::timestamptz;
  amount:=case when coalesce((e->>'legacy')::boolean,false) then 2000000*(e->>'seats')::integer else (e->>'credits')::bigint*1000*(e->>'seats')::integer end;
  source_id:='order:'||(e->>'orderId');
 end if;
 insert into crm_billing.credit_grants(workspace_id,source,kind,amount_micros,starts_at,expires_at)
 values(w,source_id,'included',amount,start_at,end_at) on conflict(workspace_id,source) do nothing;
end $$;


create or replace function public.confirm_subscription_payment(p_out_trade_no text,p_trade_no text,p_amount_fen integer,p_status text) returns uuid
language plpgsql set search_path='' set timezone='Asia/Shanghai' as $$
declare o public.subscription_orders; start_at timestamptz; first_commercial boolean; capacity integer;
begin
 select * into o from public.subscription_orders where out_trade_no=p_out_trade_no for update;
 if not found then raise exception 'Unknown order'; end if;
 if o.amount_fen is distinct from p_amount_fen or p_trade_no is null or p_trade_no !~ '^[0-9]{16,64}$' then raise exception 'Payment details do not match'; end if;
 if o.alipay_trade_no is not null and o.alipay_trade_no<>p_trade_no then raise exception 'Transaction mismatch'; end if;
 perform pg_advisory_xact_lock(hashtextextended(o.workspace_id::text,1));
 if p_status='TRADE_CLOSED' then
  update public.subscription_orders set status=case when status in ('paid','refunded') then 'refunded' else 'closed' end,alipay_trade_no=p_trade_no where id=o.id;
  update crm_billing.credit_grants set revoked_at=coalesce(revoked_at,now()) where workspace_id=o.workspace_id and (source in ('order:'||o.id::text,'topup:'||o.id::text) or source like 'order:'||o.id::text||':month:%');
  return o.id;
 end if;
 if p_status is null or p_status not in ('TRADE_SUCCESS','TRADE_FINISHED') then raise exception 'Payment is not completed'; end if;
 if o.status='paid' then return o.id; end if;
 if o.status<>'pending' then raise exception 'Order is no longer payable'; end if;
 if o.kind='credits' then
  if not crm_billing.has_access(o.workspace_id) then raise exception 'An active subscription is required'; end if;
  start_at:=now();
  insert into crm_billing.credit_grants(workspace_id,source,kind,amount_micros,starts_at,expires_at) values(o.workspace_id,'topup:'||o.id::text,'topup',3000000,start_at,start_at+interval '1 year') on conflict(workspace_id,source) do nothing;
  update public.subscription_orders set status='paid',alipay_trade_no=p_trade_no,paid_at=now(),period_start=start_at,period_end=start_at+interval '1 year' where id=o.id;
 else
  capacity:=case when o.catalog_version=1 then case when o.plan_id='team' then 5 else 1 end else o.seats end;
  if (select count(*) from public.workspace_members where workspace_id=o.workspace_id)>capacity then raise exception 'Team exceeds plan capacity'; end if;
  first_commercial:=not exists(select 1 from public.subscription_orders where workspace_id=o.workspace_id and status='paid' and kind='subscription' and catalog_version>=2);
  select greatest(now(),coalesce(max(period_end),now())) into start_at from public.subscription_orders where workspace_id=o.workspace_id and status='paid' and kind='subscription';
  update public.subscription_orders set status='paid',alipay_trade_no=p_trade_no,paid_at=now(),period_start=start_at,period_end=start_at+make_interval(months=>o.period_months) where id=o.id;
  -- Customers can lower these optional safety caps; the separate credit wallet
  -- always prevents overspend, even if admins raise their local policy later.
  if first_commercial and o.catalog_version>=2 then update public.ai_budget_policy set monthly_micros=1000000000000,daily_micros=1000000000000,minimum_shares=1 where workspace_id=o.workspace_id; end if;
  perform crm_billing.sync_included_credits(o.workspace_id);
 end if;
 return o.id;
end $$;


revoke all on function public.create_period_subscription_order(uuid,uuid,text,text,integer,text,text,integer) from public,anon,authenticated,crm_workspace_server;
grant execute on function public.create_period_subscription_order(uuid,uuid,text,text,integer,text,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
