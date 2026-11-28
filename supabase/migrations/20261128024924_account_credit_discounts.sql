begin;
set local lock_timeout='5s';

-- Codes are provisioned privately, never shipped in application source or HTML.
create table crm_billing.credit_discounts (
 id uuid primary key default gen_random_uuid(),
 code_hash text not null unique check(code_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid not null references auth.users(id),
 workspace_id uuid not null references public.workspaces(id),
 discount_percent integer not null default 100 check(discount_percent=100),
 revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create table crm_billing.credit_discount_redemptions (
 request_id uuid primary key,
 discount_id uuid not null references crm_billing.credit_discounts(id),
 user_id uuid not null references auth.users(id),
 workspace_id uuid not null references public.workspaces(id),
 credits bigint not null check(credits between 1 and 9007199254740),
 grant_id uuid not null unique references crm_billing.credit_grants(id),
 created_at timestamptz not null default now()
);
alter table crm_billing.credit_discounts enable row level security;
alter table crm_billing.credit_discount_redemptions enable row level security;
revoke all on crm_billing.credit_discounts,crm_billing.credit_discount_redemptions from public,anon,authenticated,crm_workspace_server;
grant select,insert,update on crm_billing.credit_discounts to service_role;
grant select,insert on crm_billing.credit_discount_redemptions to service_role;
create policy credit_discounts_service on crm_billing.credit_discounts for all to service_role using(true) with check(true);
create policy credit_discount_redemptions_service on crm_billing.credit_discount_redemptions for all to service_role using(true) with check(true);

create function public.check_credit_discount(p_user_id uuid,p_workspace_id uuid,p_code_hash text) returns jsonb
language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from crm_billing.credit_discounts d
  join public.workspaces w on w.id=d.workspace_id
  join public.workspace_members m on m.workspace_id=w.id and m.user_id=d.user_id
  join auth.users u on u.id=d.user_id
  where d.code_hash=p_code_hash and d.user_id=p_user_id and d.workspace_id=p_workspace_id and d.revoked_at is null
   and w.owner_id=p_user_id and m.role='admin' and m.activated_at is not null and u.email_confirmed_at is not null)
 then raise exception 'This discount code is not available for your account'; end if;
 if not coalesce(crm_billing.has_access(p_workspace_id),false) then raise exception 'An active subscription is required'; end if;
 return jsonb_build_object('discountPercent',100);
end $$;
revoke all on function public.check_credit_discount(uuid,uuid,text) from public,anon,authenticated,crm_workspace_server;
grant execute on function public.check_credit_discount(uuid,uuid,text) to service_role;

create function public.redeem_credit_discount(p_user_id uuid,p_workspace_id uuid,p_code_hash text,p_credits bigint,p_request_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare discount crm_billing.credit_discounts; previous crm_billing.credit_discount_redemptions; grant_id uuid;
begin
 if p_request_id is null or p_credits is null or p_credits not between 1 and 9007199254740 then raise exception 'Enter a valid credit amount'; end if;
 -- Same lock as paid settlement and credit reservations; each grant is atomic.
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,1));
 perform public.check_credit_discount(p_user_id,p_workspace_id,p_code_hash);
 select * into strict discount from crm_billing.credit_discounts
  where code_hash=p_code_hash and user_id=p_user_id and workspace_id=p_workspace_id and revoked_at is null for share;
 select * into previous from crm_billing.credit_discount_redemptions where request_id=p_request_id;
 if found then
  if previous.user_id<>p_user_id or previous.workspace_id<>p_workspace_id or previous.discount_id<>discount.id or previous.credits<>p_credits
   then raise exception 'Recharge request does not match'; end if;
  return jsonb_build_object('credits',previous.credits,'workspaceId',previous.workspace_id);
 end if;
 insert into crm_billing.credit_grants(workspace_id,source,kind,amount_micros,starts_at,expires_at)
  values(p_workspace_id,'discount:'||p_request_id::text,'topup',p_credits*1000,now(),now()+interval '1 year') returning id into grant_id;
 insert into crm_billing.credit_discount_redemptions(request_id,discount_id,user_id,workspace_id,credits,grant_id)
  values(p_request_id,discount.id,p_user_id,p_workspace_id,p_credits,grant_id);
 return jsonb_build_object('credits',p_credits,'workspaceId',p_workspace_id);
end $$;
revoke all on function public.redeem_credit_discount(uuid,uuid,text,bigint,uuid) from public,anon,authenticated,crm_workspace_server;
grant execute on function public.redeem_credit_discount(uuid,uuid,text,bigint,uuid) to service_role;

notify pgrst,'reload schema';
commit;
