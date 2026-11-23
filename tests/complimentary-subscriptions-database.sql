-- Run in a transaction ending in rollback. No real payments or provider calls.
do $$
declare actor uuid:=gen_random_uuid(); w uuid; c uuid; o jsonb; result jsonb; r jsonb; denied boolean; order_count bigint;
begin
 if has_table_privilege('authenticated','crm_billing.complimentary_subscriptions','insert') or has_table_privilege('crm_workspace_server','crm_billing.complimentary_subscriptions','update') or has_function_privilege('anon','public.read_complimentary_subscription(uuid)','execute') then raise exception 'FAIL: complimentary access is exposed'; end if;
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 values(actor,'authenticated','authenticated','gift-'||actor||'@example.invalid',now(),'{}','{}',now(),now());
 o:=public.create_commercial_order(actor,null,'Complimentary fixture','starter',1,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''));
 w:=(o->>'workspace_id')::uuid;
 update public.subscription_orders set status='closed' where id=(o->>'id')::uuid;
 update public.workspace_subscriptions set grandfathered=true where workspace_id=w;
 perform set_config('crm.workspace_id',w::text,true); perform set_config('role','crm_workspace_server',true);
 r:=public.reserve_ai_budget(actor,'google/gemini-2.5-flash-lite',1000);
 if r->>'allowed'<>'true' then raise exception 'FAIL: initial beta reservation'; end if;
 perform public.settle_ai_budget(actor,(r->>'reservationId')::uuid,500);
 perform set_config('role','none',true);
 select count(*) into order_count from public.subscription_orders where workspace_id=w;
 insert into crm_billing.complimentary_subscriptions(workspace_id,plan_id,seats,reason) values(w,'business',6,'Rolled-back verification') returning id into c;
 perform crm_billing.sync_included_credits(w); perform crm_billing.sync_included_credits(w);
 result:=crm_billing.entitlement(w);
 if result->>'plan'<>'business' or result->>'complimentary'<>'true' or result->>'grandfathered'<>'false' or (result#>>'{limits,companies}')::bigint<>300000 or (result#>>'{limits,mailboxes}')::bigint<>30 then raise exception 'FAIL: Business entitlement'; end if;
 result:=crm_billing.credit_balance(w);
 if (result->>'includedMicros')::bigint<>72000000 or (result->>'usedMicros')::bigint<>500 or (result->>'remainingMicros')::bigint<>71999500 then raise exception 'FAIL: beta usage lost or doubled: %',result; end if;
 if (select count(*) from crm_billing.credit_grants where workspace_id=w and kind='included')<>1 then raise exception 'FAIL: duplicate grant'; end if;
 if order_count<>(select count(*) from public.subscription_orders where workspace_id=w) then raise exception 'FAIL: complimentary access fabricated payment'; end if;
 result:=public.read_complimentary_subscription(w);
 if result->>'plan'<>'business' or (result->>'seats')::integer<>6 or result->>'expiresAt' is not null then raise exception 'FAIL: complimentary subscription status'; end if;
 denied:=false;
 begin perform public.create_commercial_order(actor,w,'Unused','business',6,'subscription','FZ'||replace(gen_random_uuid()::text,'-','')); exception when raise_exception then denied:=true; end;
 if not denied or order_count<>(select count(*) from public.subscription_orders where workspace_id=w) then raise exception 'FAIL: complimentary subscription charged'; end if;
 update public.workspace_subscriptions set grandfathered=false where workspace_id=w;
 if not crm_billing.has_access(w) then raise exception 'FAIL: complimentary-only access denied'; end if;
 perform set_config('role','crm_workspace_server',true);
 result:=public.read_billing_overview(actor);
 if result->>'complimentary'<>'true' then raise exception 'FAIL: overview omitted complimentary state'; end if;
 perform set_config('role','none',true);
 update crm_billing.complimentary_subscriptions set revoked_at=now() where id=c;
 if crm_billing.has_access(w) then raise exception 'FAIL: revoked complimentary access retained'; end if;
 perform crm_billing.sync_included_credits(w);
 if (crm_billing.credit_balance(w)->>'remainingMicros')::bigint<>0 then raise exception 'FAIL: revoked included credits retained'; end if;
end $$;
select 'Complimentary entitlement, credit preservation, billing and access checks passed; fixtures roll back' as result;
