begin;
set local lock_timeout='5s';

-- Preserve existing per-seat grants; package grants explicitly use the frozen v4 catalog.
alter table crm_billing.complimentary_subscriptions
 add column catalog_version integer not null default 2,
 add constraint complimentary_catalog check(catalog_version in (2,4)),
 add constraint complimentary_package_seats check(catalog_version<>4 or seats=case plan_id when 'starter' then 1 when 'pro' then 2 when 'business' then 5 else 0 end);

create or replace function crm_billing.entitlement(w uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c crm_billing.complimentary_subscriptions; p crm_billing.plan_catalog; package jsonb; month_start timestamptz; month_end timestamptz; result jsonb;
begin
 select * into c from crm_billing.complimentary_subscriptions where workspace_id=w and starts_at<=now() and revoked_at is null and (expires_at is null or expires_at>now());
 if not found then return crm_billing.entitlement_before_complimentary(w); end if;
 if c.catalog_version=4 then
  package:=crm_billing.package_catalog_v4(c.plan_id);
  result:=package;
 else
  select * into strict p from crm_billing.plan_catalog where id=c.plan_id;
  result:=to_jsonb(p)||jsonb_build_object('limits',jsonb_build_object('companies',p.companies*c.seats,'products',p.products*c.seats,'mailboxes',p.mailboxes*c.seats,'flows',p.flows*c.seats,'flowRuns',p.flow_runs*c.seats,'documentBytes',p.document_bytes*c.seats));
 end if;
 month_start:=date_trunc('month',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai';
 month_end:=(date_trunc('month',now() at time zone 'Asia/Shanghai')+interval '1 month') at time zone 'Asia/Shanghai';
 return result||jsonb_build_object('plan',c.plan_id,'active',true,'grandfathered',false,'complimentary',true,'complimentaryId',c.id,'seats',c.seats,'catalogVersion',c.catalog_version,
  'startsAt',month_start,'resetsAt',least(month_end,coalesce(c.expires_at,month_end)),'complimentaryExpiresAt',c.expires_at);
end $$;

create or replace function crm_billing.sync_included_credits(w uuid) returns void
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare e jsonb; source_id text; start_at timestamptz; end_at timestamptz; amount bigint; multiplier integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(w::text,1));
 e:=crm_billing.entitlement(w);
 if not coalesce((e->>'complimentary')::boolean,false) then
  update crm_billing.credit_grants set revoked_at=now() where workspace_id=w and source like 'complimentary:%' and revoked_at is null;
  perform crm_billing.sync_credits_before_complimentary(w); return;
 end if;
 start_at:=(e->>'startsAt')::timestamptz; end_at:=(e->>'resetsAt')::timestamptz;
 source_id:='complimentary:'||(e->>'complimentaryId')||':'||start_at::text;
 multiplier:=case when e->>'catalogVersion'='4' then 1 else (e->>'seats')::integer end;
 amount:=(e->>'credits')::bigint*1000*multiplier;
 -- Reuse the current grant so settled usage and in-flight reservations survive conversion.
 if not exists(select 1 from crm_billing.credit_grants where workspace_id=w and source=source_id) then
  update crm_billing.credit_grants set source=source_id,amount_micros=amount,expires_at=end_at
   where workspace_id=w and source='beta:'||start_at::text and revoked_at is null;
 end if;
 insert into crm_billing.credit_grants(workspace_id,source,kind,amount_micros,starts_at,expires_at)
 values(w,source_id,'included',amount,start_at,end_at) on conflict(workspace_id,source) do update
 set amount_micros=excluded.amount_micros,expires_at=excluded.expires_at,revoked_at=null;
end $$;

-- A retained inactive membership cannot activate a sixth user after a downgrade.
create or replace function crm_billing.enforce_seats() returns trigger
language plpgsql security definer set search_path='' as $$
declare e jsonb; capacity integer; members bigint;
begin
 if tg_op='UPDATE' and new.workspace_id=old.workspace_id and (old.activated_at is not null or new.activated_at is null) then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text,1));
 e:=crm_billing.entitlement(new.workspace_id);
 if coalesce((e->>'grandfathered')::boolean,false) then return new; end if;
 capacity:=greatest(1,coalesce((e->>'seats')::integer,1));
 select count(*) into members from public.workspace_members m where m.workspace_id=new.workspace_id
  and (tg_op<>'UPDATE' or (m.workspace_id,m.user_id) is distinct from (old.workspace_id,old.user_id));
 if members>=capacity then raise exception 'Your subscription member limit has been reached'; end if;
 return new;
end $$;

drop trigger enforce_subscription_seats on public.workspace_members;
create trigger enforce_subscription_seats before insert or update of workspace_id,activated_at
 on public.workspace_members for each row execute function crm_billing.enforce_seats();

create or replace function public.read_complimentary_subscription(p_workspace_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('plan',plan_id,'seats',seats,'expiresAt',expires_at,'catalogVersion',catalog_version) from crm_billing.complimentary_subscriptions
 where workspace_id=p_workspace_id and starts_at<=now() and revoked_at is null and (expires_at is null or expires_at>now());
$$;
-- CREATE OR REPLACE retains the existing private function privileges.
notify pgrst,'reload schema';
commit;
