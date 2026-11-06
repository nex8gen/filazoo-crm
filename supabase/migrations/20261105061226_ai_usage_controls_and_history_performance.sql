-- Preserve current defaults and billed usage. JSON member overrides live in the
-- existing workspace-scoped policy, sharing its reservation lock and RLS.
begin;
alter table public.ai_budget_policy
  add column daily_micros bigint check (daily_micros >= 0),
  add column member_limits jsonb not null default '{}'::jsonb check (jsonb_typeof(member_limits) = 'object'),
  add column revision integer not null default 0,
  add column updated_by uuid references auth.users(id) on delete set null,
  add column updated_at timestamptz not null default now();

create or replace function public.read_ai_budget(p_user_id uuid) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  p public.ai_budget_policy%rowtype; override jsonb; enabled boolean;
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
  daily_limit := coalesce(p.daily_micros,greatest(1,p.monthly_micros / days));
  override := p.member_limits -> p_user_id::text;
  enabled := coalesce((override->>'enabled')::boolean,true);
  user_limit := case when enabled then coalesce((override->>'dailyMicros')::bigint,greatest(1,daily_limit / shares)) else 0 end;
  with resets as (
    select user_id,max(reset_at) as cutoff from public.ai_budget_daily_resets
    where reset_at>=day_start and reset_at<day_end group by user_id
  )
  select coalesce(sum(coalesce(r.charged_micros,r.reserved_micros)),0),
    coalesce(sum(coalesce(r.charged_micros,r.reserved_micros)) filter(where r.created_at>=coalesce(resets.cutoff,day_start)),0),
    coalesce(sum(coalesce(r.charged_micros,r.reserved_micros)) filter(where r.created_at>=coalesce(resets.cutoff,day_start) and r.user_id=p_user_id),0)
    into monthly_used,daily_used,user_used
    from public.ai_budget_reservations r left join resets on resets.user_id=r.user_id where r.created_at>=month_start;
  return jsonb_build_object('timezone',p.timezone,'members',shares,'enabled',enabled,
    'daily',jsonb_build_object('usedMicros',user_used,'limitMicros',user_limit,'remainingMicros',greatest(0,user_limit-user_used),'percent',case when user_limit=0 then 100 else least(100,ceil(user_used::numeric/user_limit*100)) end,'resetsAt',day_end),
    'workspaceDaily',jsonb_build_object('usedMicros',daily_used,'limitMicros',daily_limit,'remainingMicros',greatest(0,daily_limit-daily_used),'percent',case when daily_limit=0 then 100 else least(100,ceil(daily_used::numeric/daily_limit*100)) end,'resetsAt',day_end),
    'monthly',jsonb_build_object('usedMicros',monthly_used,'limitMicros',p.monthly_micros,'remainingMicros',greatest(0,p.monthly_micros-monthly_used),'percent',least(100,ceil(monthly_used::numeric/p.monthly_micros*100)),'resetsAt',month_end));
end $$;

create or replace function public.reserve_ai_budget(p_user_id uuid,p_model text,p_micros bigint) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare limits jsonb; reservation_id uuid;
begin
  if p_micros is null or p_micros<=0 or p_model is null or p_model not in (
    'google/gemini-2.5-flash-lite','anthropic/claude-haiku-5.5',
    'google/gemini-3.5-flash-lite','openai/gpt-4.1-mini','openai/gpt-5-nano'
  ) then raise exception 'Invalid AI reservation'; end if;
  perform 1 from public.ai_budget_policy where id for update;
  limits := public.read_ai_budget(p_user_id);
  if limits->>'enabled'='false' then return jsonb_build_object('allowed',false,'reason','user_disabled'); end if;
  if p_micros > (limits#>>'{monthly,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','workspace_monthly'); end if;
  if p_micros > (limits#>>'{daily,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','user_daily'); end if;
  if p_micros > (limits#>>'{workspaceDaily,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','workspace_daily'); end if;
  insert into public.ai_budget_reservations(user_id,model,reserved_micros) values(p_user_id,p_model,p_micros) returning id into reservation_id;
  return jsonb_build_object('allowed',true,'reservationId',reservation_id);
end $$;

create function public.read_ai_usage_settings(p_actor_id uuid) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare p public.ai_budget_policy%rowtype; members jsonb; limits jsonb;
begin
  if not exists(select 1 from public.workspace_members where user_id=p_actor_id and role='admin' and activated_at is not null) then raise exception 'Administrator required'; end if;
  select * into strict p from public.ai_budget_policy where id;
  limits := public.read_ai_budget(p_actor_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId',m.user_id,'name',coalesce(nullif(m.display_name,''),'Member '||left(m.user_id::text,8)), 'role',m.role,
    'enabled',coalesce((p.member_limits->m.user_id::text->>'enabled')::boolean,true),
    'dailyMicros',(p.member_limits->m.user_id::text->>'dailyMicros')::bigint,
    'usedMicros',(b.value#>>'{daily,usedMicros}')::bigint,
    'effectiveDailyMicros',(b.value#>>'{daily,limitMicros}')::bigint
  ) order by m.created_at,m.user_id),'[]'::jsonb) into members
  from public.workspace_members m cross join lateral (select public.read_ai_budget(m.user_id) value) b where m.activated_at is not null;
  return jsonb_build_object('revision',p.revision,'monthlyMicros',p.monthly_micros,'dailyMicros',p.daily_micros,
    'minimumShares',p.minimum_shares,'members',members,'workspaceDailyMicros',(limits#>>'{workspaceDaily,limitMicros}')::bigint,
    'monthlyUsedMicros',(limits#>>'{monthly,usedMicros}')::bigint);
end $$;

create function public.save_ai_usage_settings(p_actor_id uuid,p_revision integer,p_policy jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare current_revision integer; member jsonb; overrides jsonb := '{}'::jsonb; target uuid;
begin
  if not exists(select 1 from public.workspace_members where user_id=p_actor_id and role='admin' and activated_at is not null) then raise exception 'Administrator required'; end if;
  select revision into strict current_revision from public.ai_budget_policy where id for update;
  if p_revision is distinct from current_revision then raise exception 'AI usage settings changed'; end if;
  if p_policy is null or jsonb_typeof(p_policy->'members') is distinct from 'array'
    or (p_policy->>'monthlyMicros') is null or (p_policy->>'minimumShares') is null
    or (p_policy->>'monthlyMicros')::bigint not between 10000 and 1000000000000
    or (p_policy->>'minimumShares')::integer not between 1 and 10000
    or coalesce((p_policy->>'dailyMicros')::bigint,0) not between 0 and 1000000000000 then raise exception 'Invalid AI usage settings'; end if;
  for member in select * from jsonb_array_elements(p_policy->'members') loop
    target := (member->>'userId')::uuid;
    if target is null or overrides ? target::text or jsonb_typeof(member->'enabled') is distinct from 'boolean'
      or coalesce((member->>'dailyMicros')::bigint,0) not between 0 and 1000000000000
      or not exists(select 1 from public.workspace_members where user_id=target and activated_at is not null) then raise exception 'Invalid AI usage member'; end if;
    overrides := overrides || jsonb_build_object(target::text,jsonb_build_object('enabled',(member->>'enabled')::boolean,'dailyMicros',(member->>'dailyMicros')::bigint));
  end loop;
  update public.ai_budget_policy set monthly_micros=(p_policy->>'monthlyMicros')::bigint,
    daily_micros=(p_policy->>'dailyMicros')::bigint,minimum_shares=(p_policy->>'minimumShares')::integer,
    member_limits=overrides,revision=revision+1,updated_by=p_actor_id,updated_at=clock_timestamp() where id;
  return public.read_ai_usage_settings(p_actor_id);
end $$;

-- Delete under the same row lock as begin/finish turn. A killed server cannot
-- leave a chat undeletable forever. Live requests retain their five-minute lease
-- (the assistant endpoint has a two-minute maximum). No transcript is returned.
create function public.delete_ai_conversation(p_user_id uuid,p_conversation_id uuid) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare c public.ai_conversations%rowtype;
begin
  if not exists(select 1 from public.workspace_members where user_id=p_user_id and activated_at is not null) then raise exception 'Active workspace member required'; end if;
  select * into c from public.ai_conversations where id=p_conversation_id and user_id=p_user_id for update;
  if not found then return jsonb_build_object('success',false); end if;
  if c.active_request is not null and exists(select 1 from public.ai_chat_turns where request_id=c.active_request and conversation_id=c.id and status='pending' and created_at>clock_timestamp()-interval '5 minutes') then
    return jsonb_build_object('success',false,'pending',true);
  end if;
  -- A pending proposal must never be executable after its chat is removed.
  update public.workspace_agent_actions set status='declined',finished_at=clock_timestamp() where conversation_id=c.id and user_id=p_user_id and status='pending';
  delete from public.ai_conversations where id=c.id and user_id=p_user_id;
  return jsonb_build_object('success',true);
end $$;

-- Resume uses the latest nonempty chat, and lists use owner/pinned ordering.
create index ai_conversations_resume_fast on public.ai_conversations(user_id,owner_role,access_key,scope,updated_at desc) where not archived and version>0;
create index ai_conversations_list_fast on public.ai_conversations(user_id,owner_role,access_key,archived,pinned desc,updated_at desc,id) where version>0;

revoke all on function public.read_ai_usage_settings(uuid),public.save_ai_usage_settings(uuid,integer,jsonb),public.delete_ai_conversation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_ai_usage_settings(uuid),public.save_ai_usage_settings(uuid,integer,jsonb),public.delete_ai_conversation(uuid,uuid) to service_role;
-- Also support databases where multi-workspace tenancy has already been applied.
do $$ begin
  if exists(select 1 from pg_roles where rolname='crm_workspace_server') then
    grant execute on function public.read_ai_usage_settings(uuid),public.save_ai_usage_settings(uuid,integer,jsonb),public.delete_ai_conversation(uuid,uuid) to crm_workspace_server;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
