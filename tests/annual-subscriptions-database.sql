-- Run inside a rollback transaction; no provider calls or retained fixtures.
do $$
declare actor uuid:=gen_random_uuid(); other_actor uuid:=gen_random_uuid(); w uuid; o jsonb; retry jsonb; renewal jsonb;
 denied boolean; starts timestamptz; ends timestamptz; balance jsonb;
begin
 if has_function_privilege('anon','public.create_period_subscription_order(uuid,uuid,text,text,integer,text,text,integer)','execute')
 or has_function_privilege('authenticated','public.create_period_subscription_order(uuid,uuid,text,text,integer,text,text,integer)','execute')
 or has_function_privilege('crm_workspace_server','public.create_period_subscription_order(uuid,uuid,text,text,integer,text,text,integer)','execute') then raise exception 'FAIL: public annual checkout capability'; end if;
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 values(actor,'authenticated','authenticated','annual-'||actor||'@example.invalid',now(),'{}','{}',now(),now()),
 (other_actor,'authenticated','authenticated','monthly-'||other_actor||'@example.invalid',now(),'{}','{}',now(),now());
 o:=public.create_period_subscription_order(actor,null,'Annual integration test','starter',2,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),12);
 w:=(o->>'workspace_id')::uuid;
 if (o->>'amount_fen')::integer<>333600 or (o->>'period_months')::integer<>12 or (o->>'catalog_version')::integer<>3 then raise exception 'FAIL: annual price'; end if;
 retry:=public.create_period_subscription_order(actor,null,'Annual integration test','starter',2,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),12);
 if retry->>'id'<>o->>'id' then raise exception 'FAIL: retry not idempotent'; end if;
 denied:=false;
 begin perform public.create_period_subscription_order(actor,w,'Annual integration test','starter',2,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),1); exception when others then denied:=true; end;
 if not denied then raise exception 'FAIL: conflicting pending cycle'; end if;
 denied:=false;
 begin perform public.create_period_subscription_order(other_actor,w,'Not owner','starter',2,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),12); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: nonowner checkout'; end if;
 denied:=false;
 begin perform public.confirm_subscription_payment(o->>'out_trade_no','202611230000000090',33360,'TRADE_SUCCESS'); exception when others then denied:=true; end;
 if not denied then raise exception 'FAIL: monthly amount accepted for annual'; end if;
 perform public.confirm_subscription_payment(o->>'out_trade_no','202611230000000090',333600,'TRADE_SUCCESS');
 perform public.confirm_subscription_payment(o->>'out_trade_no','202611230000000090',333600,'TRADE_FINISHED');
 select period_start,period_end into starts,ends from public.subscription_orders where id=(o->>'id')::uuid;
 if ends<>starts+interval '12 months' then raise exception 'FAIL: annual duration'; end if;
 if (select count(*) from crm_billing.credit_grants where workspace_id=w)<>12 then raise exception 'FAIL: monthly grant schedule or duplicate confirmation'; end if;
 balance:=crm_billing.credit_balance(w);
 if (balance->>'remainingMicros')::bigint<>4000000 then raise exception 'FAIL: annual credits available all at once'; end if;
 if (balance->>'resetsAt')::timestamptz<>starts+interval '1 month' then raise exception 'FAIL: monthly credit expiry'; end if;
 if (crm_billing.entitlement(w)->>'resetsAt')::timestamptz<>starts+interval '1 month' then raise exception 'FAIL: annual entitlement credit reset'; end if;
 renewal:=public.create_period_subscription_order(actor,w,'Annual integration test','starter',2,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),1);
 if (renewal->>'amount_fen')::integer<>33360 then raise exception 'FAIL: monthly 20 percent premium'; end if;
 perform public.confirm_subscription_payment(renewal->>'out_trade_no','202611230000000091',33360,'TRADE_SUCCESS');
 if (select period_start from public.subscription_orders where id=(renewal->>'id')::uuid)<>ends then raise exception 'FAIL: renewal discards paid access'; end if;
 perform public.confirm_subscription_payment(o->>'out_trade_no','202611230000000090',333600,'TRADE_CLOSED');
 if crm_billing.has_access(w) then raise exception 'FAIL: refunded annual access'; end if;
 if (select count(*) from crm_billing.credit_grants where workspace_id=w and revoked_at is null)<>0 then raise exception 'FAIL: refunded annual grants'; end if;
 o:=public.create_period_subscription_order(other_actor,null,'Monthly integration test','business',1,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),1);
 if (o->>'amount_fen')::integer<>67080 then raise exception 'FAIL: Business monthly price'; end if;
 perform public.confirm_subscription_payment(o->>'out_trade_no','202611230000000092',67080,'TRADE_SUCCESS');
 select period_start,period_end into starts,ends from public.subscription_orders where id=(o->>'id')::uuid;
 if ends<>starts+interval '1 month' then raise exception 'FAIL: monthly duration'; end if;
 denied:=false;
 begin update public.subscription_orders set amount_fen=1 where id=(o->>'id')::uuid; exception when check_violation then denied:=true; end;
 if not denied then raise exception 'FAIL: forged catalog amount'; end if;
 denied:=false;
 begin perform public.create_period_subscription_order(other_actor,(o->>'workspace_id')::uuid,'Invalid cycle','business',1,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),6); exception when others then denied:=true; end;
 if not denied then raise exception 'FAIL: invalid cycle'; end if;
end $$;
