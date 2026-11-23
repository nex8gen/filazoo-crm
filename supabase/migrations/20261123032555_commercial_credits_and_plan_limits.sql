-- Versioned prices preserve existing contracts. All balances use integer USD
-- micro-units: 1 credit = 1,000 units. No floating point or per-call rounding.
begin;
set local lock_timeout='5s';
create table crm_billing.plan_catalog (
  id text primary key, usd_cents integer not null, cny_fen integer not null,
  credits bigint not null, companies bigint not null, products bigint not null,
  mailboxes bigint not null, flows bigint not null, flow_runs bigint not null, document_bytes bigint not null
);
insert into crm_billing.plan_catalog values
 ('starter',1900,13900,2000,1000,500,1,3,1000,1000000000),
 ('pro',3900,27900,5000,10000,5000,3,20,10000,5000000000),
 ('business',7900,55900,12000,50000,25000,5,100,50000,20000000000);
alter table crm_billing.plan_catalog enable row level security;
revoke all on crm_billing.plan_catalog from public,anon,authenticated,crm_workspace_server;
grant all on crm_billing.plan_catalog to service_role;

alter table public.subscription_orders add column catalog_version integer not null default 1,
 add column seats integer not null default 1 check(seats between 1 and 100),
 add column kind text not null default 'subscription' check(kind in ('subscription','credits'));
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.subscription_orders'::regclass and contype='c' and pg_get_constraintdef(oid) like '%plan_id%' loop
   execute format('alter table public.subscription_orders drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.subscription_orders add constraint subscription_catalog_price check (
 (catalog_version=1 and kind='subscription' and ((plan_id='starter' and amount_fen=9900) or (plan_id='team' and amount_fen=29900))) or
 (catalog_version=2 and ((kind='subscription' and ((plan_id='starter' and amount_fen=13900*seats) or (plan_id='pro' and amount_fen=27900*seats) or (plan_id='business' and amount_fen=55900*seats))) or
 (kind='credits' and plan_id='credits_3000' and amount_fen=6900 and seats=1)))
);

create table crm_billing.credit_grants (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
 source text not null, kind text not null check(kind in ('included','topup')),
 amount_micros bigint not null check(amount_micros>0), starts_at timestamptz not null, expires_at timestamptz not null,
 revoked_at timestamptz, created_at timestamptz not null default now(),
 unique(workspace_id,source), check(expires_at>starts_at)
);
create table crm_billing.credit_allocations (
 workspace_id uuid not null, reservation_id uuid not null, grant_id uuid not null references crm_billing.credit_grants(id),
 reserved_micros bigint not null check(reserved_micros>0), charged_micros bigint check(charged_micros>=0 and charged_micros<=reserved_micros),
 primary key(workspace_id,reservation_id,grant_id),
 foreign key(workspace_id,reservation_id) references public.ai_budget_reservations(workspace_id,id) on delete restrict
);
create index credit_grants_balance on crm_billing.credit_grants(workspace_id,expires_at);
create index credit_allocations_grant on crm_billing.credit_allocations(grant_id);
-- Durable counters survive deletion of workflow history.
create table crm_billing.monthly_usage (
 workspace_id uuid not null references public.workspaces(id), period_start date not null, flow_runs bigint not null default 0,
 primary key(workspace_id,period_start)
);
alter table crm_billing.credit_grants enable row level security;
alter table crm_billing.credit_allocations enable row level security;
alter table crm_billing.monthly_usage enable row level security;
revoke all on crm_billing.credit_grants,crm_billing.credit_allocations,crm_billing.monthly_usage from public,anon,authenticated,crm_workspace_server;
grant all on crm_billing.credit_grants,crm_billing.credit_allocations,crm_billing.monthly_usage to service_role;
-- Seed counters without retroactively charging old AI usage.
insert into crm_billing.monthly_usage
 select workspace_id,date_trunc('month',started_at at time zone 'Asia/Shanghai')::date,count(*) from public.flow_runs
 where started_at>=date_trunc('month',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai' group by 1,2;

create function crm_billing.entitlement(w uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.subscription_orders; p crm_billing.plan_catalog; beta boolean;
begin
 select grandfathered into beta from public.workspace_subscriptions where workspace_id=w;
 select * into o from public.subscription_orders where workspace_id=w and kind='subscription' and status='paid' and period_start<=now() and period_end>now() order by period_start desc limit 1;
 if not found then return jsonb_build_object('plan',case when beta then 'beta' else 'inactive' end,'grandfathered',coalesce(beta,false),'active',coalesce(beta,false),'seats',0); end if;
 if o.catalog_version=1 then return jsonb_build_object('plan',o.plan_id,'legacy',true,'active',true,'grandfathered',false,'seats',case when o.plan_id='team' then 5 else 1 end,'orderId',o.id,'startsAt',o.period_start,'resetsAt',o.period_end); end if;
 select * into strict p from crm_billing.plan_catalog where id=o.plan_id;
 return to_jsonb(p)||jsonb_build_object('plan',o.plan_id,'active',true,'grandfathered',false,'seats',o.seats,'orderId',o.id,'startsAt',o.period_start,'resetsAt',o.period_end,
  'limits',jsonb_build_object('companies',p.companies*o.seats,'products',p.products*o.seats,'mailboxes',p.mailboxes*o.seats,'flows',p.flows*o.seats,'flowRuns',p.flow_runs*o.seats,'documentBytes',p.document_bytes*o.seats));
end $$;

create function crm_billing.sync_included_credits(w uuid) returns void
language plpgsql security definer set search_path='' as $$
declare e jsonb; start_at timestamptz; end_at timestamptz; amount bigint; source_id text;
begin
 perform pg_advisory_xact_lock(hashtextextended(w::text,1));
 e:=crm_billing.entitlement(w);
 if not (e->>'active')::boolean then return; end if;
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

create function crm_billing.credit_balance(w uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with grants as (
  select g.*,coalesce((select sum(coalesce(a.charged_micros,a.reserved_micros)) from crm_billing.credit_allocations a where a.grant_id=g.id),0) used
  from crm_billing.credit_grants g where g.workspace_id=w and g.starts_at<=now() and g.expires_at>now() and g.revoked_at is null
 ), totals as (
  select coalesce(sum(amount_micros) filter(where kind='included'),0) inc,coalesce(sum(amount_micros) filter(where kind='topup'),0) topup,
   coalesce(sum(used),0) used,coalesce(sum(greatest(0,amount_micros-used)),0) remaining,min(expires_at) filter(where kind='included') resets from grants
 ) select jsonb_build_object('includedMicros',inc,'topupMicros',topup,'usedMicros',used,'remainingMicros',remaining,'resetsAt',resets,'percent',case when inc+topup=0 then 100 else least(100,ceil(used/(inc+topup)*100)) end) from totals;
$$;

-- Keep existing administrative safety caps, with an independent commercial cap.
alter function public.read_ai_budget(uuid) rename to read_ai_budget_before_credits;
alter function public.read_ai_budget_before_credits(uuid) set schema crm_billing;
create function public.read_ai_budget(p_user_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb; w uuid:=crm_tenancy.workspace_id();
begin
 result:=crm_billing.read_ai_budget_before_credits(p_user_id);
 perform crm_billing.sync_included_credits(w);
 return result||jsonb_build_object('credits',crm_billing.credit_balance(w));
end $$;
alter function public.reserve_ai_budget(uuid,text,bigint) rename to reserve_ai_budget_before_credits;
alter function public.reserve_ai_budget_before_credits(uuid,text,bigint) set schema crm_billing;
-- Keep the supported model set reproducible on a freshly migrated database.
create or replace function crm_billing.reserve_ai_budget_before_credits(p_user_id uuid,p_model text,p_micros bigint) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare limits jsonb; reservation_id uuid;
begin
 if p_micros is null or p_micros<=0 or p_model is null or p_model not in ('google/gemini-2.5-flash-lite','anthropic/claude-haiku-5.5','openai/gpt-6.2-sol','google/gemini-3.5-flash-lite','openai/gpt-4.1-mini','openai/gpt-5-nano') then raise exception 'Invalid AI reservation'; end if;
 perform 1 from public.ai_budget_policy where id for update;
 limits:=public.read_ai_budget(p_user_id);
 if limits->>'enabled'='false' then return jsonb_build_object('allowed',false,'reason','user_disabled'); end if;
 if p_micros>(limits#>>'{monthly,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','workspace_monthly'); end if;
 if p_micros>(limits#>>'{daily,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','user_daily'); end if;
 if p_micros>(limits#>>'{workspaceDaily,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','workspace_daily'); end if;
 insert into public.ai_budget_reservations(user_id,model,reserved_micros) values(p_user_id,p_model,p_micros) returning id into reservation_id;
 return jsonb_build_object('allowed',true,'reservationId',reservation_id);
end $$;
-- The invoker orchestrates tenant-scoped spending caps and a narrow private
-- allocation capability. No role switching or tenant-table grants are needed.
create function crm_billing.allocate_credits(p_user_id uuid,p_id uuid,p_micros bigint) returns void
language plpgsql security definer set search_path='' as $$
declare w uuid:=crm_tenancy.workspace_id(); left_to_allocate bigint:=p_micros; g record; take bigint;
begin
 if not exists(select 1 from public.ai_budget_reservations where workspace_id=w and id=p_id and user_id=p_user_id and reserved_micros=p_micros) then raise insufficient_privilege; end if;
 for g in select c.*,c.amount_micros-coalesce((select sum(coalesce(a.charged_micros,a.reserved_micros)) from crm_billing.credit_allocations a where a.grant_id=c.id),0) available
  from crm_billing.credit_grants c where c.workspace_id=w and c.revoked_at is null and c.starts_at<=now() and c.expires_at>now() order by c.expires_at,c.id loop
  take:=least(left_to_allocate,g.available);
  if take>0 then insert into crm_billing.credit_allocations(workspace_id,reservation_id,grant_id,reserved_micros) values(w,p_id,g.id,take); left_to_allocate:=left_to_allocate-take; end if;
  exit when left_to_allocate=0;
 end loop;
 if left_to_allocate<>0 then raise exception 'Credit balance changed'; end if;
end $$;
create function public.reserve_ai_budget(p_user_id uuid,p_model text,p_micros bigint) returns jsonb
language plpgsql set search_path='' as $$
declare w uuid:=crm_tenancy.workspace_id(); result jsonb;
begin
 if p_micros is null or p_micros<=0 or p_model is null or p_model not in ('google/gemini-2.5-flash-lite','anthropic/claude-haiku-5.5','openai/gpt-6.2-sol','google/gemini-3.5-flash-lite','openai/gpt-4.1-mini','openai/gpt-5-nano') then raise exception 'Invalid AI reservation'; end if;
 -- Verify membership through tenant RLS before accessing the balance.
 if not exists(select 1 from public.workspace_members where workspace_id=w and user_id=p_user_id and activated_at is not null) then raise insufficient_privilege; end if;
 perform crm_billing.sync_included_credits(w);
 if not (crm_billing.entitlement(w)->>'active')::boolean then return jsonb_build_object('allowed',false,'reason','subscription_inactive'); end if;
 if p_micros>(crm_billing.credit_balance(w)->>'remainingMicros')::bigint then return jsonb_build_object('allowed',false,'reason','credits_exhausted'); end if;
 result:=crm_billing.reserve_ai_budget_before_credits(p_user_id,p_model,p_micros);
 if result->>'allowed'='true' then perform crm_billing.allocate_credits(p_user_id,(result->>'reservationId')::uuid,p_micros); end if;
 return result;
end $$;

alter function public.settle_ai_budget(uuid,uuid,bigint) rename to settle_ai_budget_before_credits;
alter function public.settle_ai_budget_before_credits(uuid,uuid,bigint) set schema crm_billing;
create function crm_billing.settle_credits(p_user_id uuid,p_id uuid,p_micros bigint) returns void
language plpgsql security definer set search_path='' as $$
declare w uuid:=crm_tenancy.workspace_id(); a record; remaining bigint:=p_micros; take bigint;
begin
 if not exists(select 1 from public.ai_budget_reservations where workspace_id=w and id=p_id and user_id=p_user_id and charged_micros=p_micros) then raise insufficient_privilege; end if;
 for a in select c.* from crm_billing.credit_allocations c join crm_billing.credit_grants g on g.id=c.grant_id where c.workspace_id=w and c.reservation_id=p_id order by g.expires_at,g.id loop
  take:=least(remaining,a.reserved_micros);
  if a.charged_micros is not null and a.charged_micros<>take then raise exception 'Invalid credit settlement'; end if;
  update crm_billing.credit_allocations set charged_micros=take where workspace_id=w and reservation_id=p_id and grant_id=a.grant_id;
  remaining:=remaining-take;
 end loop;
 -- Old reservations have no allocation; never debit them a second time.
end $$;
create function public.settle_ai_budget(p_user_id uuid,p_id uuid,p_micros bigint) returns void
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(crm_tenancy.workspace_id()::text,1));
 perform crm_billing.settle_ai_budget_before_credits(p_user_id,p_id,p_micros);
 perform crm_billing.settle_credits(p_user_id,p_id,p_micros);
end $$;

-- Match reservation/settlement lock order when an admin changes policy.
alter function public.save_ai_usage_settings(uuid,integer,jsonb) rename to save_ai_usage_settings_before_credits;
alter function public.save_ai_usage_settings_before_credits(uuid,integer,jsonb) set schema crm_billing;
create function public.save_ai_usage_settings(p_actor_id uuid,p_revision integer,p_policy jsonb) returns jsonb
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(crm_tenancy.workspace_id()::text,1));
 return crm_billing.save_ai_usage_settings_before_credits(p_actor_id,p_revision,p_policy);
end $$;

-- Resource caps apply inside the database, including imports and AI tools.
create function crm_billing.enforce_resource_limit() returns trigger
language plpgsql security definer set search_path='' as $$
declare e jsonb; cap bigint; used bigint; key_name text:=tg_argv[0]; key_column text:=tg_argv[1]; exists_already boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text,1));
 e:=crm_billing.entitlement(new.workspace_id); cap:=(e->'limits'->>key_name)::bigint;
 if cap is null then return new; end if;
 if tg_op='UPDATE' and new.workspace_id=old.workspace_id then return new; end if;
 execute format('select exists(select 1 from public.%I where workspace_id=$1 and %I::text=$2)',tg_table_name,key_column) into exists_already using new.workspace_id,to_jsonb(new)->>key_column;
 if exists_already then return new; end if;
 execute format('select count(*) from public.%I where workspace_id=$1',tg_table_name) into used using new.workspace_id;
 if used>=cap then raise exception using errcode='P0001',message='Plan limit reached: '||key_name||'. Review your subscription to add capacity.'; end if;
 return new;
end $$;
create trigger enforce_company_plan_limit before insert or update of workspace_id on public.companies for each row execute function crm_billing.enforce_resource_limit('companies','id');
create trigger enforce_product_plan_limit before insert or update of workspace_id on public.products for each row execute function crm_billing.enforce_resource_limit('products','sku');
create trigger enforce_mailbox_plan_limit before insert or update of workspace_id on public.workspace_mailboxes for each row execute function crm_billing.enforce_resource_limit('mailboxes','id');
create trigger enforce_flow_plan_limit before insert or update of workspace_id on public.flows for each row execute function crm_billing.enforce_resource_limit('flows','id');

create function crm_billing.enforce_flow_run_limit() returns trigger
language plpgsql security definer set search_path='' as $$
declare cap bigint; used bigint; period date:=date_trunc('month',now() at time zone 'Asia/Shanghai')::date;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text,1));
 cap:=(crm_billing.entitlement(new.workspace_id)#>>'{limits,flowRuns}')::bigint;
 if cap is null then return new; end if;
 insert into crm_billing.monthly_usage(workspace_id,period_start) values(new.workspace_id,period) on conflict do nothing;
 select flow_runs into used from crm_billing.monthly_usage where workspace_id=new.workspace_id and period_start=period for update;
 if used>=cap then raise exception 'Plan limit reached: monthly workflow runs. Review your subscription to add capacity.'; end if;
 update crm_billing.monthly_usage set flow_runs=flow_runs+1 where workspace_id=new.workspace_id and period_start=period;
 return new;
end $$;
create trigger enforce_monthly_flow_runs after insert on public.flow_runs for each row execute function crm_billing.enforce_flow_run_limit();

-- Count actual uploaded library objects, including unregistered files and trash.
-- Storage supplies metadata.size; a missing size fails closed on capped plans.
create function crm_billing.enforce_document_storage() returns trigger
language plpgsql security definer set search_path='' as $$
declare w uuid; cap bigint; used bigint; bytes bigint; previous bigint:=0;
begin
 if new.bucket_id<>'workspace-documents' then return new; end if;
 begin w:=split_part(new.name,'/',1)::uuid; exception when invalid_text_representation then return new; end;
 perform pg_advisory_xact_lock(hashtextextended(w::text,1));
 cap:=(crm_billing.entitlement(w)#>>'{limits,documentBytes}')::bigint;
 if cap is null then return new; end if;
 bytes:=(new.metadata->>'size')::bigint;
 if tg_op='UPDATE' and old.bucket_id=new.bucket_id and old.name=new.name then previous:=coalesce((old.metadata->>'size')::bigint,0); end if;
 if bytes is null then raise exception 'Document upload size is required'; end if;
 if tg_op='UPDATE' and old.bucket_id=new.bucket_id and old.name=new.name and bytes<=previous then return new; end if;
 select coalesce(sum((metadata->>'size')::bigint),0) into used from storage.objects where bucket_id='workspace-documents' and name like w::text||'/%';
 if used-previous+bytes>cap then raise exception 'Plan limit reached: document storage. Remove unused files or add capacity.'; end if;
 return new;
end $$;
create trigger enforce_document_storage_limit before insert or update of metadata,name,bucket_id on storage.objects for each row execute function crm_billing.enforce_document_storage();

-- Versioned checkout accepts only server prices and a validated seat quantity.
create function public.create_commercial_order(p_user_id uuid,p_workspace_id uuid,p_name text,p_plan_id text,p_seats integer,p_kind text,p_out_trade_no text) returns jsonb
language plpgsql set search_path='' as $$
declare w uuid:=p_workspace_id; o public.subscription_orders; e jsonb; price integer; seed jsonb;
begin
 if p_kind is null or p_kind not in ('subscription','credits') or p_seats is null or p_seats not between 1 and 100 then raise exception 'Choose a valid plan and seat count'; end if;
 if p_kind='subscription' then select cny_fen*p_seats into price from crm_billing.plan_catalog where id=p_plan_id;
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
  seed:=public.create_subscription_order(p_user_id,null,p_name,'starter',p_out_trade_no);
  w:=(seed->>'workspace_id')::uuid;
  update public.subscription_orders set catalog_version=2,plan_id=p_plan_id,seats=p_seats,amount_fen=price where id=(seed->>'id')::uuid and status='pending';
  select * into o from public.subscription_orders where id=(seed->>'id')::uuid;
  return to_jsonb(o);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text,1));
 if not exists(select 1 from public.workspaces x join public.workspace_members m on m.workspace_id=x.id where x.id=w and x.owner_id=p_user_id and m.user_id=p_user_id and m.activated_at is not null) then raise insufficient_privilege using message='Only the workspace owner can subscribe'; end if;
 e:=crm_billing.entitlement(w);
 if p_kind='credits' and not (e->>'active')::boolean then raise exception 'An active subscription is required'; end if;
 if p_kind='subscription' then
  if coalesce((e->>'grandfathered')::boolean,false) then raise exception 'Your beta workspace already has access'; end if;
  if (e->>'active')::boolean and (coalesce((e->>'legacy')::boolean,false) or e->>'plan'<>p_plan_id or (e->>'seats')::integer<>p_seats) then raise exception 'Renew the current plan and seats, or change them after expiry'; end if;
  if (select count(*) from public.workspace_members where workspace_id=w)>p_seats then raise exception 'This plan cannot hold your current team'; end if;
 end if;
 select * into o from public.subscription_orders where workspace_id=w and user_id=p_user_id and status='pending' and expires_at>now() and catalog_version=2 and plan_id=p_plan_id and seats=p_seats and kind=p_kind order by created_at desc limit 1;
 if found then return to_jsonb(o); end if;
 if exists(select 1 from public.subscription_orders where workspace_id=w and status='pending' and expires_at>now()) then raise exception 'Finish the existing checkout or wait for it to expire before changing plans'; end if;
 if (select count(*) from public.subscription_orders where user_id=p_user_id and created_at>now()-interval '15 minutes')>=6 then raise exception 'Too many checkout attempts. Please try again later'; end if;
 insert into public.subscription_orders(workspace_id,user_id,out_trade_no,catalog_version,kind,plan_id,seats,amount_fen) values(w,p_user_id,p_out_trade_no,2,p_kind,p_plan_id,p_seats,price) returning * into o;
 return to_jsonb(o);
end $$;

-- Legacy renewal also excludes top-up orders from plan and period lookups.
do $$ declare source text; updated text; begin
 select pg_get_functiondef('public.create_subscription_order(uuid,uuid,text,text,text)'::regprocedure) into source;
 updated:=replace(source,'where workspace_id=tenant and status=''paid'' and period_end>now()',
  'where workspace_id=tenant and kind=''subscription'' and status=''paid'' and period_end>now()');
 if updated=source then raise exception 'Review legacy subscription lookup before rollout'; end if;
 execute updated;
end $$;
create or replace function public.confirm_subscription_payment(p_out_trade_no text,p_trade_no text,p_amount_fen integer,p_status text) returns uuid
language plpgsql set search_path='' as $$
declare o public.subscription_orders; start_at timestamptz; first_commercial boolean; capacity integer;
begin
 select * into o from public.subscription_orders where out_trade_no=p_out_trade_no for update;
 if not found then raise exception 'Unknown order'; end if;
 if o.amount_fen is distinct from p_amount_fen or p_trade_no is null or p_trade_no !~ '^[0-9]{16,64}$' then raise exception 'Payment details do not match'; end if;
 if o.alipay_trade_no is not null and o.alipay_trade_no<>p_trade_no then raise exception 'Transaction mismatch'; end if;
 perform pg_advisory_xact_lock(hashtextextended(o.workspace_id::text,1));
 if p_status='TRADE_CLOSED' then
  update public.subscription_orders set status=case when status in ('paid','refunded') then 'refunded' else 'closed' end,alipay_trade_no=p_trade_no where id=o.id;
  update crm_billing.credit_grants set revoked_at=coalesce(revoked_at,now()) where workspace_id=o.workspace_id and source in ('order:'||o.id::text,'topup:'||o.id::text);
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
  first_commercial:=not exists(select 1 from public.subscription_orders where workspace_id=o.workspace_id and status='paid' and kind='subscription' and catalog_version=2);
  select greatest(now(),coalesce(max(period_end),now())) into start_at from public.subscription_orders where workspace_id=o.workspace_id and status='paid' and kind='subscription';
  update public.subscription_orders set status='paid',alipay_trade_no=p_trade_no,paid_at=now(),period_start=start_at,period_end=start_at+interval '1 month' where id=o.id;
  -- Customers can lower these optional safety caps; the separate credit wallet
  -- always prevents overspend, even if admins raise their local policy later.
  if first_commercial and o.catalog_version=2 then update public.ai_budget_policy set monthly_micros=1000000000000,daily_micros=1000000000000,minimum_shares=1 where workspace_id=o.workspace_id; end if;
  perform crm_billing.sync_included_credits(o.workspace_id);
 end if;
 return o.id;
end $$;

-- Top-ups never extend CRM access or inflate the paid seat allowance.
create or replace function crm_billing.has_access(p_workspace_id uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.workspace_subscriptions where workspace_id=p_workspace_id and grandfathered)
 or exists(select 1 from public.subscription_orders where workspace_id=p_workspace_id and kind='subscription' and status='paid' and period_start<=now() and period_end>now());
$$;
create or replace function crm_billing.enforce_seats() returns trigger language plpgsql security definer set search_path='' as $$
declare e jsonb; capacity integer;
begin
 if tg_op='UPDATE' and new.workspace_id=old.workspace_id then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text,1));
 e:=crm_billing.entitlement(new.workspace_id);
 if coalesce((e->>'grandfathered')::boolean,false) then return new; end if;
 capacity:=greatest(1,coalesce((e->>'seats')::integer,1));
 if (select count(*) from public.workspace_members where workspace_id=new.workspace_id)>=capacity then raise exception 'Your subscription member limit has been reached'; end if;
 return new;
end $$;

create function crm_billing.billing_overview(p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w uuid:=crm_tenancy.workspace_id(); e jsonb; usage jsonb; history jsonb;
begin
 if not exists(select 1 from public.workspace_members where workspace_id=w and user_id=p_actor_id and role='admin' and activated_at is not null) then raise insufficient_privilege; end if;
 perform crm_billing.sync_included_credits(w); e:=crm_billing.entitlement(w);
 select jsonb_build_object('companies',(select count(*) from public.companies where workspace_id=w),'products',(select count(*) from public.products where workspace_id=w),
 'mailboxes',(select count(*) from public.workspace_mailboxes where workspace_id=w),'flows',(select count(*) from public.flows where workspace_id=w),
 'flowRuns',coalesce((select flow_runs from crm_billing.monthly_usage where workspace_id=w and period_start=date_trunc('month',now() at time zone 'Asia/Shanghai')::date),0),
 'documentBytes',(select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects where bucket_id='workspace-documents' and name like w::text||'/%')) into usage;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into history from (
  select r.id,r.model,r.created_at,r.reserved_micros,r.charged_micros from public.ai_budget_reservations r
  where r.workspace_id=w order by r.created_at desc,r.id limit 50
 ) t;
 return e||jsonb_build_object('credits',crm_billing.credit_balance(w),'usage',usage,'history',history);
end $$;
create function public.read_billing_overview(p_actor_id uuid) returns jsonb language sql set search_path='' as $$ select crm_billing.billing_overview(p_actor_id); $$;

-- Default deny all new capabilities; only the trusted server can invoke them.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p where p.pronamespace='crm_billing'::regnamespace loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end $$;
grant execute on function crm_billing.entitlement(uuid),crm_billing.sync_included_credits(uuid),crm_billing.credit_balance(uuid),crm_billing.allocate_credits(uuid,uuid,bigint),crm_billing.settle_credits(uuid,uuid,bigint),crm_billing.billing_overview(uuid) to service_role,crm_workspace_server;
revoke all on function public.read_ai_budget(uuid),public.reserve_ai_budget(uuid,text,bigint),public.settle_ai_budget(uuid,uuid,bigint),public.read_billing_overview(uuid),public.save_ai_usage_settings(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.read_ai_budget(uuid),public.reserve_ai_budget(uuid,text,bigint),public.settle_ai_budget(uuid,uuid,bigint),public.read_billing_overview(uuid),public.save_ai_usage_settings(uuid,integer,jsonb) to service_role,crm_workspace_server;
revoke all on function public.create_commercial_order(uuid,uuid,text,text,integer,text,text),public.confirm_subscription_payment(text,text,integer,text) from public,anon,authenticated,crm_workspace_server;
grant execute on function public.create_commercial_order(uuid,uuid,text,text,integer,text,text),public.confirm_subscription_payment(text,text,integer,text) to service_role;
notify pgrst,'reload schema';
commit;
