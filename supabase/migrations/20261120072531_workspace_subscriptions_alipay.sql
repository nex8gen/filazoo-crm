-- Billing is server controlled. Browser clients never write payment or access state.
create schema if not exists crm_billing;
revoke all on schema crm_billing from public, anon, authenticated;
grant usage on schema crm_billing to service_role, crm_workspace_server;

create table public.workspace_subscriptions (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  grandfathered boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.subscription_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  out_trade_no text not null unique check (out_trade_no ~ '^FZ[A-Fa-f0-9]{32}$'),
  plan_id text not null check (plan_id in ('starter','team')),
  amount_fen integer not null,
  currency text not null default 'CNY' check (currency = 'CNY'),
  status text not null default 'pending' check (status in ('pending','paid','closed','refunded')),
  alipay_trade_no text unique,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  last_checked_at timestamptz,
  check ((plan_id='starter' and amount_fen=9900) or (plan_id='team' and amount_fen=29900)),
  check (status <> 'paid' or (alipay_trade_no is not null and period_start is not null and period_end>period_start))
);
create index subscription_orders_workspace_period on public.subscription_orders(workspace_id,period_end desc) where status='paid';
create index subscription_orders_user_created on public.subscription_orders(user_id,created_at desc);
alter table public.workspace_subscriptions enable row level security;
alter table public.subscription_orders enable row level security;
revoke all on public.workspace_subscriptions, public.subscription_orders from public,anon,authenticated,crm_workspace_server;
grant all on public.workspace_subscriptions, public.subscription_orders to service_role;

-- Preserve access for workspaces that existed before paid onboarding.
insert into public.workspace_subscriptions(workspace_id,grandfathered) select id,true from public.workspaces;
create function crm_billing.initialize_subscription() returns trigger language plpgsql set search_path='' as $$
begin
  insert into public.workspace_subscriptions(workspace_id) values(new.id);
  return new;
end $$;
revoke all on function crm_billing.initialize_subscription() from public,anon,authenticated;
create trigger initialize_workspace_subscription after insert on public.workspaces for each row execute function crm_billing.initialize_subscription();

create function crm_billing.has_access(p_workspace_id uuid) returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.workspace_subscriptions where workspace_id=p_workspace_id and grandfathered)
    or exists(select 1 from public.subscription_orders where workspace_id=p_workspace_id and status='paid' and period_start<=now() and period_end>now());
$$;
revoke all on function crm_billing.has_access(uuid) from public,anon,authenticated;
grant execute on function crm_billing.has_access(uuid) to service_role;

create function public.read_subscribed_workspace_session(p_user_id uuid,p_session_id uuid,p_workspace_id uuid default null)
returns table(id uuid,email text,user_metadata jsonb,role text,display_name text,activated_at timestamptz,workspace_id uuid,workspace_name text,owner_id uuid,subscription_active boolean)
language sql stable set search_path='' as $$
  select s.*,crm_billing.has_access(s.workspace_id) from crm_tenancy.read_workspace_session(p_user_id,p_session_id,p_workspace_id) s;
$$;
revoke all on function public.read_subscribed_workspace_session(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_subscribed_workspace_session(uuid,uuid,uuid) to service_role;

-- Enforce the same boundary on REST queries and background jobs.
create or replace function crm_tenancy.pre_request() returns void language plpgsql set search_path='' as $$
declare h jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb; tenant uuid; actor uuid;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then return; end if;
  if h->>'x-crm-control'='1' then return; end if;
  tenant := coalesce(nullif(h->>'x-crm-workspace-id','')::uuid,(select id from public.workspaces where is_legacy));
  if not exists(select 1 from public.workspaces where id=tenant) then raise insufficient_privilege using message='Workspace not found'; end if;
  actor := nullif(h->>'x-crm-user-id','')::uuid;
  if actor is not null and not exists(select 1 from public.workspace_members where workspace_id=tenant and user_id=actor and activated_at is not null) then raise insufficient_privilege using message='Workspace access has been revoked'; end if;
  if not crm_billing.has_access(tenant) then raise insufficient_privilege using message='An active subscription is required'; end if;
  perform set_config('crm.workspace_id',tenant::text,true);
  perform set_config('role','crm_workspace_server',true);
end $$;

create function public.create_subscription_order(p_user_id uuid,p_workspace_id uuid,p_name text,p_plan_id text,p_out_trade_no text)
returns jsonb language plpgsql set search_path='' as $$
declare tenant uuid := p_workspace_id; member_name text; result public.subscription_orders; active_plan text; seats integer;
begin
  if p_plan_id not in ('starter','team') or p_plan_id is null then raise exception 'Choose a valid plan'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select display_name into member_name from crm_tenancy.verified_user(p_user_id);
  if not found then raise exception 'Verify your email before subscribing'; end if;
  if tenant is null then
    -- Retried checkout continues the latest unfinished workspace.
    select w.id into tenant from public.workspaces w join public.workspace_subscriptions s on s.workspace_id=w.id
      where w.owner_id=p_user_id and not s.grandfathered and not exists(select 1 from public.subscription_orders o where o.workspace_id=w.id and o.status='paid')
      order by w.created_at desc limit 1;
    if tenant is null then
      if length(btrim(p_name)) not between 2 and 80 or p_name is null then raise exception 'Enter a workspace name (2–80 characters)'; end if;
      if (select count(*) from public.workspaces where owner_id=p_user_id)>=10 then raise exception 'Workspace limit reached'; end if;
      tenant := gen_random_uuid();
      insert into public.workspaces(id,name,slug,owner_id) values(tenant,btrim(p_name),'workspace-'||tenant::text,p_user_id);
      insert into public.workspace_members(workspace_id,user_id,role,display_name,activated_at) values(tenant,p_user_id,'admin',member_name,now());
      insert into public.ai_budget_policy(id,workspace_id) values(true,tenant);
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text,1));
  if not exists(select 1 from public.workspaces w join public.workspace_members m on m.workspace_id=w.id where w.id=tenant and w.owner_id=p_user_id and m.user_id=p_user_id and m.activated_at is not null) then raise insufficient_privilege using message='Only the workspace owner can subscribe'; end if;
  if exists(select 1 from public.workspace_subscriptions where workspace_id=tenant and grandfathered) then raise exception 'This workspace already has access'; end if;
  select plan_id into active_plan from public.subscription_orders where workspace_id=tenant and status='paid' and period_end>now() order by period_end desc limit 1;
  if active_plan is not null and active_plan<>p_plan_id then raise exception 'Renew the current plan, or change plans after it expires'; end if;
  seats := case p_plan_id when 'starter' then 1 else 5 end;
  if (select count(*) from public.workspace_members where workspace_id=tenant)>seats then raise exception 'This plan cannot hold your current team'; end if;
  select * into result from public.subscription_orders where workspace_id=tenant and user_id=p_user_id and status='pending' and expires_at>now() and plan_id=p_plan_id order by created_at desc limit 1;
  if found then return to_jsonb(result); end if;
  if (select count(*) from public.subscription_orders where user_id=p_user_id and created_at>now()-interval '15 minutes')>=6 then raise exception 'Too many checkout attempts. Please try again later'; end if;
  -- Prevent two simultaneous pending plans from both being paid.
  if exists(select 1 from public.subscription_orders where workspace_id=tenant and status='pending' and expires_at>now()) then raise exception 'Finish the existing checkout or wait for it to expire before changing plans'; end if;
  insert into public.subscription_orders(workspace_id,user_id,out_trade_no,plan_id,amount_fen)
    values(tenant,p_user_id,p_out_trade_no,p_plan_id,case p_plan_id when 'starter' then 9900 else 29900 end) returning * into result;
  return to_jsonb(result);
end $$;
revoke all on function public.create_subscription_order(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.create_subscription_order(uuid,uuid,text,text,text) to service_role;

create function public.confirm_subscription_payment(p_out_trade_no text,p_trade_no text,p_amount_fen integer,p_status text)
returns uuid language plpgsql set search_path='' as $$
declare o public.subscription_orders; start_at timestamptz; seats integer;
begin
  select * into o from public.subscription_orders where out_trade_no=p_out_trade_no for update;
  if not found then raise exception 'Unknown order'; end if;
  if o.amount_fen<>p_amount_fen or p_trade_no !~ '^[0-9]{16,64}$' or p_trade_no is null then raise exception 'Payment details do not match'; end if;
  if o.alipay_trade_no is not null and o.alipay_trade_no<>p_trade_no then raise exception 'Transaction mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(o.workspace_id::text,1));
  if p_status='TRADE_CLOSED' then
    update public.subscription_orders set status=case when status='paid' then 'refunded' when status='refunded' then 'refunded' else 'closed' end,alipay_trade_no=p_trade_no where id=o.id;
    return o.id;
  end if;
  if p_status not in ('TRADE_SUCCESS','TRADE_FINISHED') or p_status is null then raise exception 'Payment is not completed'; end if;
  if o.status='paid' then return o.id; end if; -- Duplicate notifications never add another month.
  if o.status<>'pending' then raise exception 'Order is no longer payable'; end if;
  select greatest(now(),coalesce(max(period_end),now())) into start_at from public.subscription_orders where workspace_id=o.workspace_id and status='paid';
  seats := case o.plan_id when 'starter' then 1 else 5 end;
  if (select count(*) from public.workspace_members where workspace_id=o.workspace_id)>seats then raise exception 'Team exceeds plan capacity'; end if;
  update public.subscription_orders set status='paid',alipay_trade_no=p_trade_no,paid_at=now(),period_start=start_at,period_end=start_at+interval '1 month' where id=o.id;
  return o.id;
end $$;
revoke all on function public.confirm_subscription_payment(text,text,integer,text) from public,anon,authenticated;
grant execute on function public.confirm_subscription_payment(text,text,integer,text) to service_role;

-- The tenant role cannot read payment records. This private trigger performs only
-- a capacity lookup, requires the trusted server role, and never exposes rows.
create function crm_billing.enforce_seats() returns trigger language plpgsql security definer set search_path='' as $$
declare seats integer; h jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
begin
  if current_setting('role',true) not in ('service_role','crm_workspace_server','none') then raise insufficient_privilege; end if;
  if tg_op='UPDATE' and new.workspace_id=old.workspace_id then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text,1));
  if exists(select 1 from public.workspace_subscriptions where workspace_id=new.workspace_id and grandfathered) then return new; end if;
  select case plan_id when 'team' then 5 else 1 end into seats from public.subscription_orders where workspace_id=new.workspace_id and status='paid' and period_start<=now() and period_end>now() order by period_end desc limit 1;
  seats := coalesce(seats,1);
  if (select count(*) from public.workspace_members where workspace_id=new.workspace_id)>=seats then raise exception 'Your subscription member limit has been reached'; end if;
  return new;
end $$;
revoke all on function crm_billing.enforce_seats() from public,anon,authenticated;
grant execute on function crm_billing.enforce_seats() to service_role,crm_workspace_server;
create trigger enforce_subscription_seats before insert or update of workspace_id on public.workspace_members for each row execute function crm_billing.enforce_seats();
notify pgrst,'reload schema';
