-- One workspace-wide lock serializes reservations across web, workers and local CRM.
create table public.ai_budget_policy (
  id boolean primary key default true check (id),
  monthly_micros bigint not null default 30000000 check (monthly_micros > 0),
  minimum_shares integer not null default 5 check (minimum_shares > 0),
  timezone text not null default 'Asia/Shanghai'
);
insert into public.ai_budget_policy (id) values (true);
create table public.ai_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  model text not null,
  reserved_micros bigint not null check (reserved_micros > 0),
  charged_micros bigint check (charged_micros >= 0 and charged_micros <= reserved_micros),
  created_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz
);
create index ai_budget_reservations_created on public.ai_budget_reservations(created_at);
create index ai_budget_reservations_owner_created on public.ai_budget_reservations(user_id,created_at);
alter table public.ai_budget_policy enable row level security;
alter table public.ai_budget_reservations enable row level security;
revoke all on public.ai_budget_policy, public.ai_budget_reservations from public, anon, authenticated;
grant all on public.ai_budget_policy, public.ai_budget_reservations to service_role;

-- Import known historical costs once. Unpriced legacy events are not invented.
insert into public.ai_budget_reservations(user_id,model,reserved_micros,charged_micros,created_at,settled_at)
select user_id, model, greatest(1,ceil(estimated_cost_usd*1000000)::bigint), ceil(estimated_cost_usd*1000000)::bigint, created_at, clock_timestamp()
from public.ai_usage_events where estimated_cost_usd > 0;

create function public.read_ai_budget(p_user_id uuid) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  p public.ai_budget_policy%rowtype;
  local_now timestamp;
  day_start timestamptz; month_start timestamptz; day_end timestamptz; month_end timestamptz;
  shares integer; days integer; daily_limit bigint; user_limit bigint;
  user_used bigint; daily_used bigint; monthly_used bigint;
begin
  select * into strict p from public.ai_budget_policy where id;
  if not exists(select 1 from public.workspace_members where user_id=p_user_id and activated_at is not null) then raise exception 'Active workspace member required'; end if;
  local_now := clock_timestamp() at time zone p.timezone;
  day_start := date_trunc('day',local_now) at time zone p.timezone;
  month_start := date_trunc('month',local_now) at time zone p.timezone;
  day_end := (date_trunc('day',local_now)+interval '1 day') at time zone p.timezone;
  month_end := (date_trunc('month',local_now)+interval '1 month') at time zone p.timezone;
  days := extract(day from date_trunc('month',local_now)+interval '1 month - 1 day')::integer;
  select greatest(p.minimum_shares,count(*)::integer) into shares from public.workspace_members where activated_at is not null;
  daily_limit := p.monthly_micros / days;
  user_limit := daily_limit / shares;
  select coalesce(sum(coalesce(charged_micros,reserved_micros)),0),
    coalesce(sum(coalesce(charged_micros,reserved_micros)) filter(where created_at>=day_start),0),
    coalesce(sum(coalesce(charged_micros,reserved_micros)) filter(where created_at>=day_start and user_id=p_user_id),0)
    into monthly_used,daily_used,user_used from public.ai_budget_reservations where created_at>=month_start;
  return jsonb_build_object('timezone',p.timezone,'members',shares,
    'daily',jsonb_build_object('usedMicros',user_used,'limitMicros',user_limit,'remainingMicros',greatest(0,user_limit-user_used),'percent',least(100,ceil(user_used::numeric/user_limit*100)),'resetsAt',day_end),
    'workspaceDaily',jsonb_build_object('usedMicros',daily_used,'limitMicros',daily_limit,'remainingMicros',greatest(0,daily_limit-daily_used),'percent',least(100,ceil(daily_used::numeric/daily_limit*100)),'resetsAt',day_end),
    'monthly',jsonb_build_object('usedMicros',monthly_used,'limitMicros',p.monthly_micros,'remainingMicros',greatest(0,p.monthly_micros-monthly_used),'percent',least(100,ceil(monthly_used::numeric/p.monthly_micros*100)),'resetsAt',month_end));
end $$;

create function public.reserve_ai_budget(p_user_id uuid,p_model text,p_micros bigint) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare limits jsonb; reservation_id uuid;
begin
  if p_micros is null or p_micros<=0 or p_model not in ('openai/gpt-6-luna','openai/gpt-6.1-sol') then raise exception 'Invalid AI reservation'; end if;
  perform 1 from public.ai_budget_policy where id for update;
  limits := public.read_ai_budget(p_user_id);
  if p_micros > (limits#>>'{monthly,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','workspace_monthly'); end if;
  if p_micros > (limits#>>'{daily,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','user_daily'); end if;
  if p_micros > (limits#>>'{workspaceDaily,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','workspace_daily'); end if;
  insert into public.ai_budget_reservations(user_id,model,reserved_micros) values(p_user_id,p_model,p_micros) returning id into reservation_id;
  return jsonb_build_object('allowed',true,'reservationId',reservation_id);
end $$;

create function public.settle_ai_budget(p_user_id uuid,p_id uuid,p_micros bigint) returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  perform 1 from public.ai_budget_policy where id for update;
  update public.ai_budget_reservations set charged_micros=p_micros,settled_at=clock_timestamp()
    where id=p_id and user_id=p_user_id and charged_micros is null and p_micros between 0 and reserved_micros;
  if not found then
    if exists(select 1 from public.ai_budget_reservations where id=p_id and user_id=p_user_id and charged_micros=p_micros) then return; end if;
    raise exception 'Invalid AI settlement';
  end if;
end $$;
revoke all on function public.read_ai_budget(uuid), public.reserve_ai_budget(uuid,text,bigint), public.settle_ai_budget(uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.read_ai_budget(uuid), public.reserve_ai_budget(uuid,text,bigint), public.settle_ai_budget(uuid,uuid,bigint) to service_role;
