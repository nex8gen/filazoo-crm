-- RPC/privilege smoke test only. No provider call or permanent reservation.
begin;
set local role service_role;
do $$
declare
  owner_id uuid;
  reservation jsonb;
  model_name text;
  rejected boolean;
  before_reset jsonb; after_reset jsonb; after_usage jsonb;
begin
  select user_id into strict owner_id from public.workspace_members where activated_at is not null order by user_id limit 1;
  if has_function_privilege('anon','public.reserve_ai_budget(uuid,text,bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.reserve_ai_budget(uuid,text,bigint)','EXECUTE') then
    raise exception 'Budget reservation RPC is exposed to browser roles';
  end if;
  foreach model_name in array array['openai/gpt-5-nano','google/gemini-2.5-flash-lite','anthropic/claude-haiku-5.5','google/gemini-3.5-flash-lite','openai/gpt-4.1-mini'] loop
    reservation := public.reserve_ai_budget(owner_id,model_name,1);
    if reservation->>'allowed' <> 'true' then raise exception 'No allowance for a one-micro reservation: %',reservation; end if;
    if not exists(select 1 from public.ai_budget_reservations where id=(reservation->>'reservationId')::uuid and user_id=owner_id and model=model_name and reserved_micros=1) then
      raise exception 'Reservation lost its owner, model or amount';
    end if;
    perform public.settle_ai_budget(owner_id,(reservation->>'reservationId')::uuid,0);
    perform public.settle_ai_budget(owner_id,(reservation->>'reservationId')::uuid,0);
    if not exists(select 1 from public.ai_budget_reservations where id=(reservation->>'reservationId')::uuid and charged_micros=0 and settled_at is not null) then
      raise exception 'Reservation did not settle idempotently';
    end if;
  end loop;
  foreach model_name in array array['unpriced-model','openai/gpt-6-luna','openai/gpt-6.1-terra','openai/gpt-6.1-sol',null::text] loop
    rejected := false;
    begin
      perform public.reserve_ai_budget(owner_id,model_name,1);
    exception when raise_exception then
      if sqlerrm <> 'Invalid AI reservation' then raise; end if;
      rejected := true;
    end;
    if not rejected then raise exception 'Unpriced model was accepted'; end if;
  end loop;
  reservation := public.reserve_ai_budget(owner_id,'openai/gpt-5-nano',1000000000000);
  if reservation->>'allowed' <> 'false' or reservation->>'reason' <> 'workspace_monthly' then raise exception 'Overspending was accepted'; end if;
  before_reset := public.read_ai_budget(owner_id);
  reservation := public.reserve_ai_budget(owner_id,'openai/gpt-5-nano',1000);
  if reservation->>'allowed' <> 'true' then raise exception 'No allowance for reset smoke test'; end if;
  perform public.settle_ai_budget(owner_id,(reservation->>'reservationId')::uuid,1000);
  insert into public.ai_budget_daily_resets(user_id,reset_by,reason) values(owner_id,owner_id,'Rolled-back reset verification');
  after_reset := public.read_ai_budget(owner_id);
  if (after_reset#>>'{daily,usedMicros}')::bigint <> 0 then raise exception 'Daily meter was not reset'; end if;
  if (after_reset#>>'{monthly,usedMicros}')::bigint <> (before_reset#>>'{monthly,usedMicros}')::bigint+1000 then raise exception 'Reset erased monthly billed usage'; end if;
  if after_reset#>>'{daily,limitMicros}' <> before_reset#>>'{daily,limitMicros}' then raise exception 'Reset changed daily allowance'; end if;
  reservation := public.reserve_ai_budget(owner_id,'openai/gpt-5-nano',10);
  perform public.settle_ai_budget(owner_id,(reservation->>'reservationId')::uuid,10);
  after_usage := public.read_ai_budget(owner_id);
  if (after_usage#>>'{daily,usedMicros}')::bigint <> 10 then raise exception 'New daily usage was not counted'; end if;
  if (after_usage#>>'{monthly,usedMicros}')::bigint <> (before_reset#>>'{monthly,usedMicros}')::bigint+1010 then raise exception 'Monthly usage was not preserved'; end if;
  if has_table_privilege('anon','public.ai_budget_daily_resets','INSERT') or has_table_privilege('authenticated','public.ai_budget_daily_resets','INSERT') then raise exception 'Daily resets are exposed to browser roles'; end if;
end $$;
rollback;
select 'Budget RPC checks passed; all test reservations rolled back' as result;
