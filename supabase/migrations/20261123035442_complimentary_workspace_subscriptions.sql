begin;
create table crm_billing.complimentary_subscriptions (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null unique references public.workspaces(id),
 plan_id text not null references crm_billing.plan_catalog(id), seats integer not null check(seats between 1 and 100),
 starts_at timestamptz not null default now(), expires_at timestamptz, revoked_at timestamptz,
 reason text not null check(length(btrim(reason)) between 1 and 500), created_at timestamptz not null default now(),
 check(expires_at is null or expires_at>starts_at)
);
alter table crm_billing.complimentary_subscriptions enable row level security;
revoke all on crm_billing.complimentary_subscriptions from public,anon,authenticated,crm_workspace_server;
grant all on crm_billing.complimentary_subscriptions to service_role;
create policy billing_service_only on crm_billing.complimentary_subscriptions for all to service_role using(true) with check(true);

alter function crm_billing.entitlement(uuid) rename to entitlement_before_complimentary;
create function crm_billing.entitlement(w uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c crm_billing.complimentary_subscriptions; p crm_billing.plan_catalog; month_start timestamptz; month_end timestamptz;
begin
 select * into c from crm_billing.complimentary_subscriptions where workspace_id=w and starts_at<=now() and revoked_at is null and (expires_at is null or expires_at>now());
 if not found then return crm_billing.entitlement_before_complimentary(w); end if;
 select * into strict p from crm_billing.plan_catalog where id=c.plan_id;
 month_start:=date_trunc('month',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai';
 month_end:=(date_trunc('month',now() at time zone 'Asia/Shanghai')+interval '1 month') at time zone 'Asia/Shanghai';
 return to_jsonb(p)||jsonb_build_object('plan',c.plan_id,'active',true,'grandfathered',false,'complimentary',true,'complimentaryId',c.id,'seats',c.seats,
 'startsAt',month_start,'resetsAt',least(month_end,coalesce(c.expires_at,month_end)),'complimentaryExpiresAt',c.expires_at,
 'limits',jsonb_build_object('companies',p.companies*c.seats,'products',p.products*c.seats,'mailboxes',p.mailboxes*c.seats,'flows',p.flows*c.seats,'flowRuns',p.flow_runs*c.seats,'documentBytes',p.document_bytes*c.seats));
end $$;

alter function crm_billing.sync_included_credits(uuid) rename to sync_credits_before_complimentary;
create function crm_billing.sync_included_credits(w uuid) returns void
language plpgsql security definer set search_path='' as $$
declare e jsonb; source_id text; start_at timestamptz; end_at timestamptz; amount bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended(w::text,1));
 e:=crm_billing.entitlement(w);
 if not coalesce((e->>'complimentary')::boolean,false) then
  update crm_billing.credit_grants set revoked_at=now() where workspace_id=w and source like 'complimentary:%' and revoked_at is null;
  perform crm_billing.sync_credits_before_complimentary(w); return;
 end if;
 start_at:=(e->>'startsAt')::timestamptz; end_at:=(e->>'resetsAt')::timestamptz;
 source_id:='complimentary:'||(e->>'complimentaryId')||':'||start_at::text;
 amount:=(e->>'credits')::bigint*1000*(e->>'seats')::integer;
 -- Upgrade the beta allowance in place so prior usage/reservations remain
 -- charged and the workspace does not receive two included monthly pools.
 if not exists(select 1 from crm_billing.credit_grants where workspace_id=w and source=source_id) then
  update crm_billing.credit_grants set source=source_id,amount_micros=amount,expires_at=end_at
   where workspace_id=w and source='beta:'||start_at::text and revoked_at is null;
 end if;
 insert into crm_billing.credit_grants(workspace_id,source,kind,amount_micros,starts_at,expires_at)
 values(w,source_id,'included',amount,start_at,end_at) on conflict(workspace_id,source) do update
 set amount_micros=excluded.amount_micros,expires_at=excluded.expires_at,revoked_at=null;
end $$;

create or replace function crm_billing.has_access(p_workspace_id uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from crm_billing.complimentary_subscriptions where workspace_id=p_workspace_id and starts_at<=now() and revoked_at is null and (expires_at is null or expires_at>now()))
 or exists(select 1 from public.workspace_subscriptions where workspace_id=p_workspace_id and grandfathered)
 or exists(select 1 from public.subscription_orders where workspace_id=p_workspace_id and kind='subscription' and status='paid' and period_start<=now() and period_end>now());
$$;

create function public.read_complimentary_subscription(p_workspace_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('plan',plan_id,'seats',seats,'expiresAt',expires_at) from crm_billing.complimentary_subscriptions
 where workspace_id=p_workspace_id and starts_at<=now() and revoked_at is null and (expires_at is null or expires_at>now());
$$;

-- A complimentary workspace cannot accidentally purchase a subscription renewal.
alter function public.create_commercial_order(uuid,uuid,text,text,integer,text,text) set schema crm_billing;
alter function crm_billing.create_commercial_order(uuid,uuid,text,text,integer,text,text) rename to create_order_before_complimentary;
create function public.create_commercial_order(p_user_id uuid,p_workspace_id uuid,p_name text,p_plan_id text,p_seats integer,p_kind text,p_out_trade_no text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if p_kind='subscription' and p_workspace_id is not null and coalesce((crm_billing.entitlement(p_workspace_id)->>'complimentary')::boolean,false) then raise exception 'This workspace has a complimentary subscription. No payment is required'; end if;
 return crm_billing.create_order_before_complimentary(p_user_id,p_workspace_id,p_name,p_plan_id,p_seats,p_kind,p_out_trade_no);
end $$;
revoke all on function crm_billing.entitlement_before_complimentary(uuid),crm_billing.entitlement(uuid),crm_billing.sync_credits_before_complimentary(uuid),crm_billing.sync_included_credits(uuid),public.read_complimentary_subscription(uuid),public.create_commercial_order(uuid,uuid,text,text,integer,text,text) from public,anon,authenticated;
grant execute on function crm_billing.entitlement(uuid),crm_billing.sync_included_credits(uuid) to service_role,crm_workspace_server;
revoke all on function public.read_complimentary_subscription(uuid),public.create_commercial_order(uuid,uuid,text,text,integer,text,text),crm_billing.create_order_before_complimentary(uuid,uuid,text,text,integer,text,text) from crm_workspace_server;
grant execute on function public.read_complimentary_subscription(uuid),public.create_commercial_order(uuid,uuid,text,text,integer,text,text) to service_role;
notify pgrst,'reload schema';
commit;
