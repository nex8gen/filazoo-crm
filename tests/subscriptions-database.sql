begin;
do $$
declare owner_id uuid := gen_random_uuid(); other_id uuid := gen_random_uuid();
  w uuid; o jsonb; again jsonb; first_end timestamptz; failure boolean;
begin
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
    values(owner_id,'authenticated','authenticated','billing-test-'||owner_id||'@example.invalid',now(),'{}','{}',now(),now()),
    (other_id,'authenticated','authenticated','billing-test-'||other_id||'@example.invalid',now(),'{}','{}',now(),now());
  o := public.create_subscription_order(owner_id,null,'Billing integration test','starter','FZ'||replace(gen_random_uuid()::text,'-',''));
  w := (o->>'workspace_id')::uuid;
  if crm_billing.has_access(w) then raise exception 'FAIL: unpaid workspace was unlocked'; end if;
  again := public.create_subscription_order(owner_id,w,'Unused','starter','FZ'||replace(gen_random_uuid()::text,'-',''));
  if again->>'id'<>o->>'id' then raise exception 'FAIL: duplicate checkout created another order'; end if;
  failure := false;
  begin perform public.create_subscription_order(other_id,w,'Unused','team','FZ'||replace(gen_random_uuid()::text,'-','')); exception when insufficient_privilege then failure := true; end;
  if not failure then raise exception 'FAIL: another user could subscribe to this workspace'; end if;
  failure := false;
  begin perform public.confirm_subscription_payment(o->>'out_trade_no','202611200000000001',1,'TRADE_SUCCESS'); exception when others then failure := true; end;
  if not failure or crm_billing.has_access(w) then raise exception 'FAIL: wrong amount unlocked workspace'; end if;
  failure := false;
  begin perform public.confirm_subscription_payment(o->>'out_trade_no','202611200000000001',9900,'WAIT_BUYER_PAY'); exception when others then failure := true; end;
  if not failure then raise exception 'FAIL: unpaid transaction was accepted'; end if;
  perform public.confirm_subscription_payment(o->>'out_trade_no','202611200000000001',9900,'TRADE_SUCCESS');
  if not crm_billing.has_access(w) then raise exception 'FAIL: confirmed payment did not unlock workspace'; end if;
  select period_end into first_end from public.subscription_orders where id=(o->>'id')::uuid;
  perform public.confirm_subscription_payment(o->>'out_trade_no','202611200000000001',9900,'TRADE_FINISHED');
  if first_end<>(select period_end from public.subscription_orders where id=(o->>'id')::uuid) then raise exception 'FAIL: replay extended the subscription'; end if;
  failure := false;
  begin insert into public.workspace_members(workspace_id,user_id,role,activated_at) values(w,other_id,'viewer',now()); exception when others then failure := true; end;
  if not failure then raise exception 'FAIL: Starter allowed a second member'; end if;
  failure := false;
  begin perform public.create_subscription_order(owner_id,w,'Unused','team','FZ'||replace(gen_random_uuid()::text,'-','')); exception when others then failure := true; end;
  if not failure then raise exception 'FAIL: active plan changed mid-cycle'; end if;
  again := public.create_subscription_order(owner_id,w,'Unused','starter','FZ'||replace(gen_random_uuid()::text,'-',''));
  perform public.confirm_subscription_payment(again->>'out_trade_no','202611200000000002',9900,'TRADE_SUCCESS');
  if (select period_start from public.subscription_orders where id=(again->>'id')::uuid)<>first_end then raise exception 'FAIL: renewal lost paid days'; end if;
  perform public.confirm_subscription_payment(o->>'out_trade_no','202611200000000001',9900,'TRADE_CLOSED');
  if crm_billing.has_access(w) then raise exception 'FAIL: refund retained current-period access'; end if;
  failure := false;
  begin perform public.confirm_subscription_payment(o->>'out_trade_no','202611200000000001',9900,'TRADE_SUCCESS'); exception when others then failure := true; end;
  if not failure then raise exception 'FAIL: stale notification revived refunded order'; end if;
  if exists(select 1 from public.workspaces where is_legacy and not crm_billing.has_access(id)) then raise exception 'FAIL: existing workspace lost access'; end if;
  if has_table_privilege('authenticated','public.subscription_orders','insert') or has_table_privilege('anon','public.subscription_orders','select')
    or has_function_privilege('authenticated','public.confirm_subscription_payment(text,text,integer,text)','execute') then raise exception 'FAIL: billing API is publicly writable'; end if;
end $$;
rollback;
