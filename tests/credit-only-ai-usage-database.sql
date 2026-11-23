-- Run after the migration in a transaction ending in rollback. No provider calls.
do $$
declare actor uuid:=gen_random_uuid(); member uuid:=gen_random_uuid(); w uuid; o jsonb; r jsonb; summary jsonb; denied boolean;
begin
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 values(actor,'authenticated','authenticated','credit-mode-'||actor||'@example.invalid',now(),'{}','{}',now(),now());
 o:=public.create_commercial_order(actor,null,'Credit-only fixture','starter',1,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''));
 w:=(o->>'workspace_id')::uuid;
 update public.subscription_orders set status='closed' where id=(o->>'id')::uuid;
 insert into crm_billing.complimentary_subscriptions(workspace_id,plan_id,seats,reason) values(w,'business',6,'Rolled-back credit-only verification');
 update public.ai_budget_policy set monthly_micros=10000,daily_micros=0,minimum_shares=100,
  member_limits=jsonb_build_object(actor::text,jsonb_build_object('enabled',false,'dailyMicros',0)) where workspace_id=w;
 perform set_config('crm.workspace_id',w::text,true); perform set_config('role','crm_workspace_server',true);
 r:=public.reserve_ai_budget(actor,'google/gemini-2.5-flash-lite',1);
 if r->>'allowed'<>'false' or r->>'reason'<>'user_disabled' then raise exception 'FAIL: existing controls changed for non-credit-only workspace'; end if;
 perform set_config('role','none',true);
 update public.ai_budget_policy set credit_only=true where workspace_id=w;
 perform set_config('role','crm_workspace_server',true);
 summary:=public.read_ai_budget(actor);
 if summary->>'creditOnly'<>'true' or summary->>'enabled'<>'true' or (summary#>>'{monthly,remainingMicros}')::bigint<>72000000 then raise exception 'FAIL: credit-only summary retains old limits: %',summary; end if;
 if public.read_ai_usage_settings(actor)->>'creditOnly'<>'true' or public.read_billing_overview(actor)->>'creditOnly'<>'true' then raise exception 'FAIL: settings mode omitted'; end if;
 summary:=public.read_billing_overview(actor);
 if summary ? 'history' or summary ? 'model' or (summary->>'memberCount')::int<>1 then raise exception 'FAIL: customer summary must contain totals only: %',summary; end if;
 denied:=false;
 begin perform public.read_billing_overview(gen_random_uuid()); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: another actor accessed the billing summary'; end if;
 perform set_config('role','none',true);
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 values(member,'authenticated','authenticated','summary-member-'||member||'@example.invalid',now(),'{}','{}',now(),now());
 insert into public.workspace_members(workspace_id,user_id,role,activated_at) values(w,member,'operator',now());
 perform set_config('role','crm_workspace_server',true);
 denied:=false;
 begin perform public.read_billing_overview(member); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: non-admin accessed the billing summary'; end if;
 perform set_config('role','none',true);
 delete from public.workspace_members where workspace_id=w and user_id=member;
 perform set_config('role','crm_workspace_server',true);
 -- Old $30 and daily/member caps cannot reject an affordable Business request.
 r:=public.reserve_ai_budget(actor,'google/gemini-2.5-flash-lite',31000000);
 if r->>'allowed'<>'true' then raise exception 'FAIL: legacy cap blocked Business credits: %',r; end if;
 perform public.settle_ai_budget(actor,(r->>'reservationId')::uuid,0);
 denied:=false;
 begin perform public.save_ai_usage_settings(actor,0,'{}'); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: stale editor could reinstate old rules'; end if;
 denied:=false;
 begin perform public.reserve_ai_budget(gen_random_uuid(),'google/gemini-2.5-flash-lite',1); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: credit-only mode bypassed membership'; end if;
 r:=public.reserve_ai_budget(actor,'google/gemini-2.5-flash-lite',72000000);
 if r->>'allowed'<>'true' then raise exception 'FAIL: full plan balance unavailable'; end if;
 summary:=public.reserve_ai_budget(actor,'google/gemini-2.5-flash-lite',1);
 if summary->>'allowed'<>'false' or summary->>'reason'<>'credits_exhausted' then raise exception 'FAIL: wallet overspend allowed'; end if;
 perform public.settle_ai_budget(actor,(r->>'reservationId')::uuid,37000000);
 if (public.read_ai_budget(actor)#>>'{credits,remainingMicros}')::bigint<>35000000 then raise exception 'FAIL: settlement lost billed usage'; end if;
 perform set_config('role','none',true);
 update public.ai_budget_policy set credit_only=false where workspace_id=w;
 perform set_config('role','crm_workspace_server',true);
 r:=public.reserve_ai_budget(actor,'google/gemini-2.5-flash-lite',1);
 if r->>'allowed'<>'false' or r->>'reason'<>'user_disabled' then raise exception 'FAIL: other workspace policy compatibility'; end if;
 perform set_config('role','none',true);
end $$;
select 'Plan credits replace legacy caps; wallet enforcement, isolation and settlement passed' as result;
