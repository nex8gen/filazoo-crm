-- Run only in a transaction ending in ROLLBACK. No provider calls or real payments.
do $$
declare actor uuid:=gen_random_uuid(); member uuid:=gen_random_uuid(); w uuid; initial jsonb; pricing jsonb; o jsonb; again jsonb; balance bigint; denied boolean; pid uuid; actual integer;
begin
 if has_function_privilege('anon','public.create_credit_recharge_order(uuid,uuid,uuid,bigint,integer,text)','execute')
 or has_function_privilege('authenticated','public.create_credit_recharge_order(uuid,uuid,uuid,bigint,integer,text)','execute')
 or has_function_privilege('crm_workspace_server','public.create_credit_recharge_order(uuid,uuid,uuid,bigint,integer,text)','execute')
 or has_function_privilege('authenticated','public.prepare_credit_recharge_pricing(bigint,date)','execute')
 or has_table_privilege('authenticated','crm_billing.credit_recharge_pricing','select') then raise exception 'FAIL: browser can mint or inspect private pricing'; end if;
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
  values(actor,'authenticated','authenticated','recharge-'||actor||'@example.invalid',now(),'{}','{}',now(),now()),
  (member,'authenticated','authenticated','recharge-'||member||'@example.invalid',now(),'{}','{}',now(),now());
 initial:=public.create_package_subscription_order(actor,null,'Recharge fixture','starter',1,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),1);
 w:=(initial->>'workspace_id')::uuid;
 pricing:=public.prepare_credit_recharge_pricing(6500000,(now() at time zone 'UTC')::date);
 pid:=(pricing->>'id')::uuid;
 if (pricing->>'rateMicros')::bigint<>6630000 then raise exception 'FAIL: quote calculation'; end if;
 again:=public.prepare_credit_recharge_pricing(6500000,(now() at time zone 'UTC')::date);
 if again->>'id'<>pricing->>'id' then raise exception 'FAIL: duplicate rate snapshot'; end if;
 denied:=false;
 begin perform public.create_credit_recharge_order(actor,w,pid,3000,1989,'FZ'||replace(gen_random_uuid()::text,'-','')); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: inactive subscription can recharge'; end if;
 perform public.confirm_subscription_payment(initial->>'out_trade_no','202611280000000010',(initial->>'amount_fen')::integer,'TRADE_SUCCESS');
 balance:=(crm_billing.credit_balance(w)->>'remainingMicros')::bigint;
 denied:=false;
 begin perform public.create_credit_recharge_order(member,w,pid,3000,1989,'FZ'||replace(gen_random_uuid()::text,'-','')); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: non-owner can recharge'; end if;
 denied:=false;
 begin perform public.create_credit_recharge_order(actor,w,pid,3000,1,'FZ'||replace(gen_random_uuid()::text,'-','')); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: client can lower total'; end if;
 denied:=false;
 begin perform public.create_credit_recharge_order(actor,w,pid,0,1,'FZ'||replace(gen_random_uuid()::text,'-','')); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: zero credit order'; end if;
 o:=public.create_credit_recharge_order(actor,w,pid,12345,8185,'FZ'||replace(gen_random_uuid()::text,'-',''));
 if (o->>'credit_quantity')::bigint<>12345 or (o->>'amount_fen')::integer<>8185 or (o->>'catalog_version')::int<>5 then raise exception 'FAIL: custom amount'; end if;
 again:=public.create_credit_recharge_order(actor,w,pid,12345,8185,'FZ'||replace(gen_random_uuid()::text,'-',''));
 if again->>'id'<>o->>'id' then raise exception 'FAIL: pending retry creates duplicate charge'; end if;
 denied:=false;
 begin update public.subscription_orders set credit_quantity=12346,amount_fen=8186 where id=(o->>'id')::uuid; exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: locked price changed'; end if;
 denied:=false;
 begin perform public.confirm_subscription_payment(o->>'out_trade_no','202611280000000011',1,'TRADE_SUCCESS'); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: underpayment granted credits'; end if;
 perform public.confirm_subscription_payment(o->>'out_trade_no','202611280000000011',8185,'TRADE_SUCCESS');
 perform public.confirm_subscription_payment(o->>'out_trade_no','202611280000000011',8185,'TRADE_FINISHED');
 if (crm_billing.credit_balance(w)->>'remainingMicros')::bigint<>balance+12345000 then raise exception 'FAIL: incorrect quantity or duplicate grant'; end if;
 -- No package cap: a second recharge can exceed the monthly included allowance.
 o:=public.create_credit_recharge_order(actor,w,pid,1000000,663000,'FZ'||replace(gen_random_uuid()::text,'-',''));
 perform public.confirm_subscription_payment(o->>'out_trade_no','202611280000000012',663000,'TRADE_SUCCESS');
 if (crm_billing.credit_balance(w)->>'remainingMicros')::bigint<>balance+1012345000 then raise exception 'FAIL: repeated or large recharge capped'; end if;
 perform public.confirm_subscription_payment(o->>'out_trade_no','202611280000000012',663000,'TRADE_CLOSED');
 if (crm_billing.credit_balance(w)->>'remainingMicros')::bigint<>balance+12345000 then raise exception 'FAIL: refund did not revoke custom quantity'; end if;
 denied:=false;
 begin perform public.prepare_credit_recharge_pricing(6500000,(now() at time zone 'UTC')::date-8); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: stale source accepted'; end if;
 insert into crm_billing.credit_recharge_pricing(base_rate_micros,source_date,created_at,expires_at)
  values(6500000,(now() at time zone 'UTC')::date,now()-interval '2 hours',now()-interval '1 hour') returning id into pid;
 denied:=false;
 begin perform public.create_credit_recharge_order(actor,w,pid,3000,1989,'FZ'||replace(gen_random_uuid()::text,'-','')); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: expired quote accepted'; end if;
 -- A legacy fixed-price pending checkout still settles its original 3,000 credits.
 o:=public.create_commercial_order(actor,w,'Unused','credits_3000',1,'credits','FZ'||replace(gen_random_uuid()::text,'-',''));
 perform public.confirm_subscription_payment(o->>'out_trade_no','202611280000000013',6900,'TRADE_SUCCESS');
 if (crm_billing.credit_balance(w)->>'remainingMicros')::bigint<>balance+15345000 then raise exception 'FAIL: historical recharge changed'; end if;
end $$;
select 'custom recharge database verification passed' as result;
