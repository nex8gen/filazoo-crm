begin;
alter table public.ai_budget_policy add column credit_only boolean not null default false;

create or replace function public.read_ai_budget(p_user_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid:=crm_tenancy.workspace_id(); p public.ai_budget_policy; credits jsonb; meter jsonb; members integer; result jsonb;
begin
 select * into strict p from public.ai_budget_policy where workspace_id=w and id;
 if not exists(select 1 from public.workspace_members where workspace_id=w and user_id=p_user_id and activated_at is not null) then raise insufficient_privilege using message='Active workspace member required'; end if;
 perform crm_billing.sync_included_credits(w); credits:=crm_billing.credit_balance(w);
 if not p.credit_only then
  result:=crm_billing.read_ai_budget_before_credits(p_user_id);
  return result||jsonb_build_object('credits',credits,'creditOnly',false);
 end if;
 select count(*)::integer into members from public.workspace_members where workspace_id=w and activated_at is not null;
 meter:=jsonb_build_object('usedMicros',credits->'usedMicros','limitMicros',(credits->>'includedMicros')::bigint+(credits->>'topupMicros')::bigint,
  'remainingMicros',credits->'remainingMicros','percent',credits->'percent','resetsAt',credits->'resetsAt');
 -- Legacy response fields remain adapters for older clients and research
 -- preflight. They all reflect the same wallet, not independent daily caps.
 return jsonb_build_object('timezone',p.timezone,'members',members,'enabled',true,'creditOnly',true,
  'daily',meter,'workspaceDaily',meter,'monthly',meter,'credits',credits);
end $$;

create or replace function crm_billing.reserve_ai_budget_before_credits(p_user_id uuid,p_model text,p_micros bigint) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare limits jsonb; reservation_id uuid; credit_mode boolean;
begin
 if p_micros is null or p_micros<=0 or p_model is null or p_model not in ('google/gemini-2.5-flash-lite','anthropic/claude-haiku-5.5','openai/gpt-6.2-sol','google/gemini-3.5-flash-lite','openai/gpt-4.1-mini','openai/gpt-5-nano') then raise exception 'Invalid AI reservation'; end if;
 select credit_only into strict credit_mode from public.ai_budget_policy where workspace_id=crm_tenancy.workspace_id() and id for update;
 if not credit_mode then
  limits:=public.read_ai_budget(p_user_id);
  if limits->>'enabled'='false' then return jsonb_build_object('allowed',false,'reason','user_disabled'); end if;
  if p_micros>(limits#>>'{monthly,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','workspace_monthly'); end if;
  if p_micros>(limits#>>'{daily,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','user_daily'); end if;
  if p_micros>(limits#>>'{workspaceDaily,remainingMicros}')::bigint then return jsonb_build_object('allowed',false,'reason','workspace_daily'); end if;
 end if;
 -- The public reservation function already holds the workspace lock, validates
 -- active membership/subscription and atomically checks the credit balance.
 insert into public.ai_budget_reservations(user_id,model,reserved_micros) values(p_user_id,p_model,p_micros) returning id into reservation_id;
 return jsonb_build_object('allowed',true,'reservationId',reservation_id);
end $$;

alter function public.read_ai_usage_settings(uuid) set schema crm_billing;
alter function crm_billing.read_ai_usage_settings(uuid) rename to read_usage_settings_before_credit_only;
create function public.read_ai_usage_settings(p_actor_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select crm_billing.read_usage_settings_before_credit_only(p_actor_id)||jsonb_build_object('creditOnly',p.credit_only)
 from public.ai_budget_policy p where p.workspace_id=crm_tenancy.workspace_id() and p.id;
$$;

create or replace function public.save_ai_usage_settings(p_actor_id uuid,p_revision integer,p_policy jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(crm_tenancy.workspace_id()::text,1));
 if exists(select 1 from public.ai_budget_policy where workspace_id=crm_tenancy.workspace_id() and id and credit_only) then
  raise exception 'AI uses plan credits. Manage your plan and credits instead of legacy spending limits';
 end if;
 return crm_billing.save_ai_usage_settings_before_credits(p_actor_id,p_revision,p_policy);
end $$;

create or replace function public.read_billing_overview(p_actor_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select crm_billing.billing_overview(p_actor_id)||jsonb_build_object('creditOnly',p.credit_only)
 from public.ai_budget_policy p where p.workspace_id=crm_tenancy.workspace_id() and p.id;
$$;
revoke all on function public.read_ai_usage_settings(uuid),crm_billing.read_usage_settings_before_credit_only(uuid) from public,anon,authenticated;
grant execute on function public.read_ai_usage_settings(uuid) to service_role,crm_workspace_server;
notify pgrst,'reload schema';
commit;
