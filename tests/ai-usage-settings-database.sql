-- Exercise every spending control against real RPCs without changing team policy.
begin;
set local role service_role;
do $$
declare
  actor uuid; member jsonb; settings jsonb; saved jsonb; limits jsonb; result jsonb;
  members jsonb; member_count integer; days integer; zone text;
  baseline_monthly bigint; baseline_reservations bigint;
begin
  select user_id into strict actor from public.workspace_members where role='admin' and activated_at is not null order by created_at limit 1;
  settings := public.read_ai_usage_settings(actor);
  baseline_monthly := (settings->>'monthlyUsedMicros')::bigint;
  select count(*) into baseline_reservations from public.ai_budget_reservations;
  member_count := jsonb_array_length(settings->'members');
  select timezone into strict zone from public.ai_budget_policy where id;
  days := extract(day from date_trunc('month',clock_timestamp() at time zone zone)+interval '1 month - 1 day')::integer;

  -- Blank caps use the current calendar month and the configured minimum shares.
  select jsonb_agg(jsonb_build_object('userId',m->>'userId','enabled',true,'dailyMicros',null)) into members from jsonb_array_elements(settings->'members') m;
  saved := public.save_ai_usage_settings(actor,(settings->>'revision')::integer,jsonb_build_object(
    'monthlyMicros',days*1000000,'dailyMicros',null,'minimumShares',member_count+3,'members',members));
  if (saved->>'workspaceDailyMicros')::bigint<>1000000 then raise exception 'Automatic workspace daily cap failed'; end if;
  for member in select * from jsonb_array_elements(saved->'members') loop
    if (member->>'effectiveDailyMicros')::bigint<>1000000/(member_count+3) then raise exception 'Minimum shares failed'; end if;
  end loop;

  -- A custom daily cap replaces automatic division, with active-member sharing.
  saved := jsonb_set(jsonb_set(saved,'{dailyMicros}','3000000'::jsonb),'{minimumShares}','1'::jsonb);
  saved := public.save_ai_usage_settings(actor,(saved->>'revision')::integer,saved);
  if (saved->>'workspaceDailyMicros')::bigint<>3000000 then raise exception 'Custom workspace daily cap failed'; end if;
  for member in select * from jsonb_array_elements(saved->'members') loop
    if (member->>'effectiveDailyMicros')::bigint<>3000000/member_count then raise exception 'Active member sharing failed'; end if;
  end loop;

  -- Every active member, including the administrator, can be paused and resumed.
  select jsonb_agg(jsonb_build_object('userId',m->>'userId','enabled',false,'dailyMicros',500000)) into members from jsonb_array_elements(saved->'members') m;
  saved := public.save_ai_usage_settings(actor,(saved->>'revision')::integer,jsonb_set(saved,'{members}',members));
  for member in select * from jsonb_array_elements(saved->'members') loop
    limits := public.read_ai_budget((member->>'userId')::uuid);
    if limits->>'enabled'<>'false' or (limits#>>'{daily,limitMicros}')::bigint<>0 then raise exception 'Member pause failed'; end if;
    result := public.reserve_ai_budget((member->>'userId')::uuid,'openai/gpt-4.1-mini',1);
    if result->>'allowed'<>'false' or result->>'reason'<>'user_disabled' then raise exception 'Paused member reached spending'; end if;
  end loop;
  select jsonb_agg(jsonb_build_object('userId',m->>'userId','enabled',true,'dailyMicros',1000000000000)) into members from jsonb_array_elements(saved->'members') m;
  saved := public.save_ai_usage_settings(actor,(saved->>'revision')::integer,jsonb_set(saved,'{members}',members));
  for member in select * from jsonb_array_elements(saved->'members') loop
    if member->>'enabled'<>'true' or (member->>'dailyMicros')::bigint<>1000000000000 then raise exception 'Member resume or custom cap failed'; end if;
  end loop;

  -- A large personal allowance still cannot bypass a workspace daily cap of zero.
  saved := public.save_ai_usage_settings(actor,(saved->>'revision')::integer,jsonb_set(saved,'{dailyMicros}','0'::jsonb));
  result := public.reserve_ai_budget(actor,'openai/gpt-4.1-mini',1);
  if result->>'allowed'<>'false' or result->>'reason'<>'workspace_daily' then raise exception 'Personal cap bypassed workspace daily cap'; end if;

  -- A lowered monthly budget applies immediately without erasing billed usage.
  saved := jsonb_set(jsonb_set(saved,'{dailyMicros}','1000000000000'::jsonb),'{monthlyMicros}','10000'::jsonb);
  saved := public.save_ai_usage_settings(actor,(saved->>'revision')::integer,saved);
  result := public.reserve_ai_budget(actor,'openai/gpt-4.1-mini',10001);
  if result->>'allowed'<>'false' or result->>'reason'<>'workspace_monthly' then raise exception 'Monthly cap not enforced'; end if;
  if (saved->>'monthlyUsedMicros')::bigint<>baseline_monthly then raise exception 'Saving limits erased billed usage'; end if;
  if (select count(*) from public.ai_budget_reservations)<>baseline_reservations then raise exception 'Denied requests wrote reservations'; end if;

  -- Restoring allowance permits a reservation again; no provider is called.
  saved := jsonb_set(jsonb_set(saved,'{dailyMicros}','1000000000000'::jsonb),'{monthlyMicros}','1000000000000'::jsonb);
  saved := public.save_ai_usage_settings(actor,(saved->>'revision')::integer,saved);
  result := public.reserve_ai_budget(actor,'openai/gpt-4.1-mini',1);
  if result->>'allowed'<>'true' then raise exception 'Restored allowance did not permit a reservation'; end if;
  perform public.settle_ai_budget(actor,(result->>'reservationId')::uuid,0);
end $$;
rollback;
select 'All AI spending controls passed; settings and reservations rolled back' as result;
