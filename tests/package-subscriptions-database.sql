-- Roll back every fixture. No real payments or provider calls.
do $$
declare item record; actor uuid; member uuid; w uuid; o jsonb; retried jsonb; e jsonb; balance jsonb; r jsonb; denied boolean; periods integer; i integer; trade text;
begin
 if has_function_privilege('anon','public.create_package_subscription_order(uuid,uuid,text,text,integer,text,text,integer)','execute')
 or has_function_privilege('authenticated','public.create_package_subscription_order(uuid,uuid,text,text,integer,text,text,integer)','execute')
 or has_function_privilege('crm_workspace_server','public.create_package_subscription_order(uuid,uuid,text,text,integer,text,text,integer)','execute') then raise exception 'FAIL: public package checkout privilege'; end if;
 for item in select * from (values ('starter',1,2000,13900,130800),('pro',2,6000,42900,430800),('business',5,15000,92900,934800)) as p(plan,members,credits,monthly,annual) loop
  foreach periods in array array[1,12] loop
   actor:=gen_random_uuid(); trade:=(202611230000000000::bigint+item.members*100+periods)::text;
   insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
    values(actor,'authenticated','authenticated','package-'||actor||'@example.invalid',now(),'{}','{}',now(),now());
   denied:=false;
   begin perform public.create_package_subscription_order(actor,null,'Wrong quantity',item.plan,item.members+1,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),periods); exception when raise_exception then denied:=true; end;
   if not denied then raise exception 'FAIL: arbitrary seats accepted'; end if;
   o:=public.create_package_subscription_order(actor,null,'Package test',item.plan,item.members,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),periods);
   w:=(o->>'workspace_id')::uuid;
   if (o->>'catalog_version')::int<>4 or (o->>'seats')::int<>item.members or (o->>'amount_fen')::int<>(case when periods=12 then item.annual else item.monthly end) then raise exception 'FAIL: package price or membership: %',o; end if;
   retried:=public.create_package_subscription_order(actor,w,'Package test',item.plan,item.members,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),periods);
   if o->>'id'<>retried->>'id' then raise exception 'FAIL: duplicate pending package'; end if;
   denied:=false;
   begin perform public.create_package_subscription_order(gen_random_uuid(),w,'Other actor',item.plan,item.members,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),periods); exception when insufficient_privilege then denied:=true; end;
   if not denied then raise exception 'FAIL: another actor started checkout'; end if;
   denied:=false;
   begin update public.subscription_orders set amount_fen=1 where id=(o->>'id')::uuid; exception when check_violation then denied:=true; end;
   if not denied then raise exception 'FAIL: forged price accepted'; end if;
   denied:=false;
   begin perform public.confirm_subscription_payment(o->>'out_trade_no',trade,1,'TRADE_SUCCESS'); exception when raise_exception then denied:=true; end;
   if not denied then raise exception 'FAIL: underpayment accepted'; end if;
   perform public.confirm_subscription_payment(o->>'out_trade_no',trade,(o->>'amount_fen')::int,'TRADE_SUCCESS');
   perform public.confirm_subscription_payment(o->>'out_trade_no',trade,(o->>'amount_fen')::int,'TRADE_FINISHED');
   e:=crm_billing.entitlement(w); balance:=crm_billing.credit_balance(w);
   if (balance->>'remainingMicros')::bigint<>item.credits*1000 or (e->>'seats')::int<>item.members or (e->>'catalogVersion')::int<>4 then raise exception 'FAIL: credits multiplied by users: %',balance; end if;
   if e->'limits' is distinct from crm_billing.package_catalog_v4(item.plan)->'limits' then raise exception 'FAIL: package capacity multiplied'; end if;
   if (select count(*) from crm_billing.credit_grants where workspace_id=w)<>periods then raise exception 'FAIL: grant schedule or payment replay'; end if;
   if not (select credit_only from public.ai_budget_policy where workspace_id=w) then raise exception 'FAIL: legacy dollar controls retained'; end if;
   for i in 2..item.members+1 loop
    member:=gen_random_uuid();
    insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
     values(member,'authenticated','authenticated','package-member-'||member||'@example.invalid',now(),'{}','{}',now(),now());
    denied:=false;
    begin insert into public.workspace_members(workspace_id,user_id,role,activated_at) values(w,member,'operator',now()); exception when raise_exception then denied:=true; end;
    if denied<>(i>item.members) then raise exception 'FAIL: included membership cap %/%',i,item.members; end if;
   end loop;
   if (select count(*) from public.workspace_members where workspace_id=w)<>item.members then raise exception 'FAIL: included teammate required a separate purchase'; end if;
   perform set_config('crm.workspace_id',w::text,true); perform set_config('role','crm_workspace_server',true);
   r:=public.reserve_ai_budget(actor,'google/gemini-2.5-flash-lite',item.credits*1000+1);
   if r->>'allowed'<>'false' or r->>'reason'<>'credits_exhausted' then raise exception 'FAIL: AI package allowance not enforced: %',r; end if;
   perform set_config('role','none',true);
   perform public.confirm_subscription_payment(o->>'out_trade_no',trade,(o->>'amount_fen')::int,'TRADE_CLOSED');
   if crm_billing.has_access(w) or (select count(*) from crm_billing.credit_grants where workspace_id=w and revoked_at is null)>0 then raise exception 'FAIL: refunded package access or credits'; end if;
   if item.members>1 then
    denied:=false;
    begin perform public.create_package_subscription_order(actor,w,'Too small','starter',1,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),1); exception when raise_exception then denied:=true; end;
    if not denied then raise exception 'FAIL: package too small for team'; end if;
   end if;
  end loop;
 end loop;
end $$;
select 'Fixed packages: prices, shared credits, included teammates, permissions, annual schedules, refunds and quota enforcement passed' as result;
