-- Preserve billed usage; daily resets are separate, private audit events.
create table public.ai_budget_daily_resets (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reset_by uuid references auth.users(id) on delete set null,
  reset_at timestamptz not null default clock_timestamp(),
  reason text not null check (length(trim(reason)) > 0)
);
create index ai_budget_daily_resets_owner_time on public.ai_budget_daily_resets(user_id,reset_at desc);
alter table public.ai_budget_daily_resets enable row level security;
revoke all on public.ai_budget_daily_resets from public,anon,authenticated;
revoke all on sequence public.ai_budget_daily_resets_id_seq from public,anon,authenticated;
grant all on public.ai_budget_daily_resets to service_role;
grant usage,select on sequence public.ai_budget_daily_resets_id_seq to service_role;

create or replace function public.read_ai_budget(p_user_id uuid) returns jsonb
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
  with resets as (
    select user_id,max(reset_at) as cutoff from public.ai_budget_daily_resets
    where reset_at>=day_start and reset_at<day_end group by user_id
  )
  select coalesce(sum(coalesce(r.charged_micros,r.reserved_micros)),0),
    coalesce(sum(coalesce(r.charged_micros,r.reserved_micros)) filter(where r.created_at>=coalesce(resets.cutoff,day_start)),0),
    coalesce(sum(coalesce(r.charged_micros,r.reserved_micros)) filter(where r.created_at>=coalesce(resets.cutoff,day_start) and r.user_id=p_user_id),0)
    into monthly_used,daily_used,user_used
    from public.ai_budget_reservations r left join resets on resets.user_id=r.user_id where r.created_at>=month_start;
  return jsonb_build_object('timezone',p.timezone,'members',shares,
    'daily',jsonb_build_object('usedMicros',user_used,'limitMicros',user_limit,'remainingMicros',greatest(0,user_limit-user_used),'percent',least(100,ceil(user_used::numeric/user_limit*100)),'resetsAt',day_end),
    'workspaceDaily',jsonb_build_object('usedMicros',daily_used,'limitMicros',daily_limit,'remainingMicros',greatest(0,daily_limit-daily_used),'percent',least(100,ceil(daily_used::numeric/daily_limit*100)),'resetsAt',day_end),
    'monthly',jsonb_build_object('usedMicros',monthly_used,'limitMicros',p.monthly_micros,'remainingMicros',greatest(0,p.monthly_micros-monthly_used),'percent',least(100,ceil(monthly_used::numeric/p.monthly_micros*100)),'resetsAt',month_end));
end $$;

-- Existing reservations can still settle; new requests may use only nano.
create or replace function public.reserve_ai_budget(p_user_id uuid,p_model text,p_micros bigint) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare limits jsonb; reservation_id uuid;
begin
  if p_micros is null or p_micros<=0 or p_model is distinct from 'openai/gpt-5-nano' then raise exception 'Invalid AI reservation'; end if;
  perform 1 from public.ai_budget_policy where id for update;
  limits := public.read_ai_budget(p_user_id);
  if p_micros > (limits#>>'{monthly,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','workspace_monthly'); end if;
  if p_micros > (limits#>>'{daily,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','user_daily'); end if;
  if p_micros > (limits#>>'{workspaceDaily,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','workspace_daily'); end if;
  insert into public.ai_budget_reservations(user_id,model,reserved_micros) values(p_user_id,p_model,p_micros) returning id into reservation_id;
  return jsonb_build_object('allowed',true,'reservationId',reservation_id);
end $$;
revoke all on function public.read_ai_budget(uuid),public.reserve_ai_budget(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.read_ai_budget(uuid),public.reserve_ai_budget(uuid,text,bigint) to service_role;
