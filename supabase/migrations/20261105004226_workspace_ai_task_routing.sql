-- Task-specific low-cost models; retain nano during rolling restarts.
-- Allowance amounts, accounting, locking and privileges remain unchanged.
create or replace function public.reserve_ai_budget(p_user_id uuid,p_model text,p_micros bigint) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare limits jsonb; reservation_id uuid;
begin
  if p_micros is null or p_micros<=0 or p_model is null or p_model not in (
    'google/gemini-2.5-flash-lite',
    'anthropic/claude-haiku-5.5',
    'google/gemini-3.5-flash-lite',
    'openai/gpt-4.1-mini',
    'openai/gpt-5-nano'
  ) then raise exception 'Invalid AI reservation'; end if;
  perform 1 from public.ai_budget_policy where id for update;
  limits := public.read_ai_budget(p_user_id);
  if p_micros > (limits#>>'{monthly,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','workspace_monthly'); end if;
  if p_micros > (limits#>>'{daily,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','user_daily'); end if;
  if p_micros > (limits#>>'{workspaceDaily,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','workspace_daily'); end if;
  insert into public.ai_budget_reservations(user_id,model,reserved_micros) values(p_user_id,p_model,p_micros) returning id into reservation_id;
  return jsonb_build_object('allowed',true,'reservationId',reservation_id);
end $$;
revoke all on function public.reserve_ai_budget(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.reserve_ai_budget(uuid,text,bigint) to service_role;
