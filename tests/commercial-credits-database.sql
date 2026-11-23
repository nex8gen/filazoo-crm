-- Execute after the migration, in the same rolled-back transaction for rollout
-- verification. No provider calls, SMTP, real payments or persistent fixtures.
do $$
declare actor uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); w uuid; w2 uuid; o jsonb; renewal jsonb; topup jsonb; result jsonb; balance jsonb;
 fid uuid:=gen_random_uuid(); cid uuid:=gen_random_uuid(); denied boolean; initial_end timestamptz; reservation_id uuid; legacy_owner uuid:=gen_random_uuid(); legacy_w uuid;
begin
 if has_function_privilege('anon','public.reserve_ai_budget(uuid,text,bigint)','execute') or has_function_privilege('authenticated','public.read_billing_overview(uuid)','execute') then raise exception 'FAIL: browser can access credit RPCs'; end if;
 if has_table_privilege('crm_workspace_server','crm_billing.credit_grants','insert') then raise exception 'FAIL: tenant role can mint credits'; end if;
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 values(actor,'authenticated','authenticated','credits-'||actor||'@example.invalid',now(),'{}','{}',now(),now()),
 (stranger,'authenticated','authenticated','credits-'||stranger||'@example.invalid',now(),'{}','{}',now(),now());
 o:=public.create_commercial_order(actor,null,'Credit integration test','starter',3,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''));
 w:=(o->>'workspace_id')::uuid;
 if (o->>'amount_fen')::integer<>41700 or (o->>'catalog_version')::integer<>2 then raise exception 'FAIL: seat pricing'; end if;
 result:=public.create_commercial_order(actor,null,'Credit integration test','starter',3,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''));
 if result->>'id'<>o->>'id' then raise exception 'FAIL: checkout retry not idempotent'; end if;
 denied:=false;
 begin perform public.confirm_subscription_payment(o->>'out_trade_no','202611230000000010',1,'TRADE_SUCCESS'); exception when others then denied:=true; end;
 if not denied or crm_billing.has_access(w) then raise exception 'FAIL: forged price unlocked access'; end if;
 perform public.confirm_subscription_payment(o->>'out_trade_no','202611230000000010',41700,'TRADE_SUCCESS');
 perform public.confirm_subscription_payment(o->>'out_trade_no','202611230000000010',41700,'TRADE_FINISHED');
 balance:=crm_billing.credit_balance(w);
 if (balance->>'remainingMicros')::bigint<>6000000 then raise exception 'FAIL: included allowance: %',balance; end if;
 initial_end:=(crm_billing.entitlement(w)->>'resetsAt')::timestamptz;
 if (crm_billing.entitlement(w)#>>'{limits,companies}')::bigint<>3000 then raise exception 'FAIL: pooled capacity'; end if;
 perform set_config('crm.workspace_id',w::text,true);
 perform set_config('role','crm_workspace_server',true);
 denied:=false;
 begin perform public.reserve_ai_budget(stranger,'google/gemini-2.5-flash-lite',1); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: cross-member spending'; end if;
 result:=public.reserve_ai_budget(actor,'google/gemini-2.5-flash-lite',1500000);
 if result->>'allowed'<>'true' then raise exception 'FAIL: valid reservation: %',result; end if;
 reservation_id:=(result->>'reservationId')::uuid;
 balance:=public.read_ai_budget(actor)->'credits';
 if (balance->>'remainingMicros')::bigint<>4500000 then raise exception 'FAIL: reserved credits still available'; end if;
 -- Administrative policy writes use the same lock order as paid reservations.
 result:=public.read_ai_usage_settings(actor);
 perform public.save_ai_usage_settings(actor,(result->>'revision')::integer,result);
 perform public.settle_ai_budget(actor,reservation_id,1200000);
 perform public.settle_ai_budget(actor,reservation_id,1200000);
 if (public.read_ai_budget(actor)#>>'{credits,remainingMicros}')::bigint<>4800000 then raise exception 'FAIL: settlement did not release exactly unused reservation'; end if;
 denied:=false;
 begin perform public.settle_ai_budget(actor,reservation_id,1000000); exception when others then denied:=true; end;
 if not denied then raise exception 'FAIL: conflicting settlement accepted'; end if;
 -- Raising local admin safety limits cannot mint commercial credit.
 update public.ai_budget_policy set monthly_micros=1000000000000,daily_micros=1000000000000 where workspace_id=w;
 result:=public.reserve_ai_budget(actor,'google/gemini-2.5-flash-lite',4800001);
 if result->>'allowed'<>'false' or result->>'reason'<>'credits_exhausted' then raise exception 'FAIL: credit cap bypassed: %',result; end if;
 result:=public.reserve_ai_budget(actor,'google/gemini-2.5-flash-lite',1);
 perform public.settle_ai_budget(actor,(result->>'reservationId')::uuid,0);
 if (public.read_ai_budget(actor)#>>'{credits,remainingMicros}')::bigint<>4800000 then raise exception 'FAIL: sub-credit precision'; end if;
 perform set_config('role','none',true);
 renewal:=public.create_commercial_order(actor,w,'Unused','starter',3,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''));
 perform public.confirm_subscription_payment(renewal->>'out_trade_no','202611230000000011',41700,'TRADE_SUCCESS');
 if (crm_billing.credit_balance(w)->>'remainingMicros')::bigint<>4800000 then raise exception 'FAIL: renewal granted next month early'; end if;
 if (crm_billing.entitlement(w)->>'resetsAt')::timestamptz<>initial_end then raise exception 'FAIL: renewal reset current allowance'; end if;
 topup:=public.create_commercial_order(actor,w,'Unused','credits_3000',1,'credits','FZ'||replace(gen_random_uuid()::text,'-',''));
 perform public.confirm_subscription_payment(topup->>'out_trade_no','202611230000000012',6900,'TRADE_SUCCESS');
 perform public.confirm_subscription_payment(topup->>'out_trade_no','202611230000000012',6900,'TRADE_FINISHED');
 if (crm_billing.credit_balance(w)->>'remainingMicros')::bigint<>7800000 then raise exception 'FAIL: top-up replay or balance'; end if;
 if (crm_billing.entitlement(w)->>'resetsAt')::timestamptz<>initial_end or (crm_billing.entitlement(w)->>'seats')::integer<>3 then raise exception 'FAIL: topup changed subscription'; end if;
 -- One reservation may consume both included and purchased credits.
 perform set_config('role','crm_workspace_server',true);
 result:=public.reserve_ai_budget(actor,'google/gemini-2.5-flash-lite',5000000);
 if result->>'allowed'<>'true' then raise exception 'FAIL: split allocation'; end if;
 perform public.settle_ai_budget(actor,(result->>'reservationId')::uuid,4900000);
 perform set_config('role','none',true);
 if (crm_billing.credit_balance(w)->>'remainingMicros')::bigint<>2900000 then raise exception 'FAIL: split settlement'; end if;
 perform public.confirm_subscription_payment(topup->>'out_trade_no','202611230000000012',6900,'TRADE_CLOSED');
 if (crm_billing.credit_balance(w)->>'remainingMicros')::bigint<>0 then raise exception 'FAIL: refunded credits remain spendable'; end if;
 -- Shrink fixture-only limits to test boundaries without inserting thousands.
 update crm_billing.plan_catalog c set companies=1,products=1,mailboxes=1,flows=1,flow_runs=1,document_bytes=10 where c.id='starter';
 perform set_config('role','crm_workspace_server',true);
 insert into public.companies(id,workspace_id,name) values(cid,w,'Fixture customer'),(gen_random_uuid(),w,'Fixture 2'),(gen_random_uuid(),w,'Fixture 3');
 -- Upserts at capacity are edits, not new resource allocations.
 insert into public.companies(id,workspace_id,name) values(cid,w,'Fixture updated') on conflict(workspace_id,id) do update set name=excluded.name;
 denied:=false;
 begin insert into public.companies(workspace_id,name) values(w,'Over cap'); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: customer limit'; end if;
 insert into public.products(workspace_id,sku,name) values(w,'credit-1','Fixture 1'),(w,'credit-2','Fixture 2'),(w,'credit-3','Fixture 3');
 denied:=false;
 begin insert into public.products(workspace_id,sku,name) values(w,'credit-4','Over cap'); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: product limit'; end if;
 insert into public.workspace_mailboxes(workspace_id,user_id,type,email,display_name) values(w,actor,'personal','fixture1@example.invalid','Fixture 1'),(w,actor,'personal','fixture2@example.invalid','Fixture 2'),(w,actor,'personal','fixture3@example.invalid','Fixture 3');
 denied:=false;
 begin insert into public.workspace_mailboxes(workspace_id,user_id,type,email,display_name) values(w,actor,'personal','fixture4@example.invalid','Over cap'); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: mailbox limit'; end if;
 insert into public.flows(id,workspace_id,user_id,name,trigger_type,created_by) values(fid,w,actor,'Fixture flow','email_received',actor),(gen_random_uuid(),w,actor,'Fixture 2','email_received',actor),(gen_random_uuid(),w,actor,'Fixture 3','email_received',actor);
 denied:=false;
 begin insert into public.flows(workspace_id,user_id,name,trigger_type,created_by) values(w,actor,'Over cap','email_received',actor); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: flow limit'; end if;
 insert into public.flow_runs(workspace_id,flow_id,conversation_id,status) values(w,fid,'fixture-1','done'),(w,fid,'fixture-2','done'),(w,fid,'fixture-3','done');
 delete from public.flow_runs where workspace_id=w;
 denied:=false;
 begin insert into public.flow_runs(workspace_id,flow_id,conversation_id) values(w,fid,'fixture-4'); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: deleting history bypassed monthly run limit'; end if;
 -- Paid seats are enforced when membership is written, not merely in the UI.
 insert into public.workspace_members(workspace_id,user_id,role,display_name,activated_at) values(w,stranger,'viewer','Fixture colleague',now());
 perform set_config('role','none',true);
 insert into storage.objects(bucket_id,name,metadata) values('workspace-documents',w::text||'/fixture-1','{"size":20}');
 denied:=false;
 begin insert into storage.objects(bucket_id,name,metadata) values('workspace-documents',w::text||'/fixture-2','{"size":11}'); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: physical storage limit'; end if;
 -- Expired grants never return to the balance.
 insert into crm_billing.credit_grants(workspace_id,source,kind,amount_micros,starts_at,expires_at) values(w,'expired-fixture','topup',1000000,now()-interval '2 days',now()-interval '1 day');
 if (crm_billing.credit_balance(w)->>'remainingMicros')::bigint<>0 then raise exception 'FAIL: expired credits spendable'; end if;
 -- Separate workspace with same actor gets a separate balance.
 o:=public.create_commercial_order(actor,null,'Second fixture workspace','pro',1,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''));
 w2:=(o->>'workspace_id')::uuid;
 perform public.confirm_subscription_payment(o->>'out_trade_no','202611230000000013',27900,'TRADE_SUCCESS');
 perform set_config('crm.workspace_id',w2::text,true); perform set_config('role','crm_workspace_server',true);
 if (public.read_ai_budget(actor)#>>'{credits,remainingMicros}')::bigint<>5000000 then raise exception 'FAIL: cross-workspace credit leakage'; end if;
 denied:=false;
 begin perform public.read_billing_overview(stranger); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: billing overview exposed'; end if;
 perform set_config('role','none',true);
 update public.subscription_orders set period_start=now()-interval '2 months',period_end=now()-interval '1 month' where workspace_id=w2;
 if crm_billing.has_access(w2) then raise exception 'FAIL: expired subscription access'; end if;
 -- Legacy renewals keep their original price and ignore the one-year top-up term.
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 values(legacy_owner,'authenticated','authenticated','legacy-'||legacy_owner||'@example.invalid',now(),'{}','{}',now(),now());
 denied:=false;
 begin perform public.create_subscription_order(legacy_owner,null,'Retired price attempt','team','FZ'||replace(gen_random_uuid()::text,'-','')); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: retired price allowed for new workspace'; end if;
 o:=crm_billing.create_legacy_subscription_order(legacy_owner,null,'Legacy fixture workspace','team','FZ'||replace(gen_random_uuid()::text,'-',''));
 legacy_w:=(o->>'workspace_id')::uuid;
 perform public.confirm_subscription_payment(o->>'out_trade_no','202611230000000014',29900,'TRADE_SUCCESS');
 initial_end:=(crm_billing.entitlement(legacy_w)->>'resetsAt')::timestamptz;
 topup:=public.create_commercial_order(legacy_owner,legacy_w,'Unused','credits_3000',1,'credits','FZ'||replace(gen_random_uuid()::text,'-',''));
 perform public.confirm_subscription_payment(topup->>'out_trade_no','202611230000000015',6900,'TRADE_SUCCESS');
 renewal:=public.create_subscription_order(legacy_owner,legacy_w,'Unused','team','FZ'||replace(gen_random_uuid()::text,'-',''));
 perform public.confirm_subscription_payment(renewal->>'out_trade_no','202611230000000016',29900,'TRADE_SUCCESS');
 if (renewal->>'amount_fen')::integer<>29900 then raise exception 'FAIL: legacy renewal repriced'; end if;
 if (select period_start from public.subscription_orders where id=(renewal->>'id')::uuid)<>initial_end then raise exception 'FAIL: topup extended legacy access'; end if;
 -- Beta workspaces keep access and get one shared calendar-month grant.
 update public.workspace_subscriptions set grandfathered=true where workspace_id=w2;
 perform crm_billing.sync_included_credits(w2); perform crm_billing.sync_included_credits(w2);
 if (crm_billing.credit_balance(w2)->>'remainingMicros')::bigint<>15000000 then raise exception 'FAIL: beta grant duplication'; end if;
 fid:=gen_random_uuid();
 insert into public.flows(id,workspace_id,user_id,name,trigger_type,created_by) values(fid,w2,actor,'Beta usage fixture','email_received',actor);
 insert into public.flow_runs(workspace_id,flow_id,conversation_id,status) values(w2,fid,'beta-counter-fixture','done');
 if (select flow_runs from crm_billing.monthly_usage where workspace_id=w2 and period_start=date_trunc('month',now() at time zone 'Asia/Shanghai')::date)<>1 then raise exception 'FAIL: uncapped beta usage not counted'; end if;
end $$;
select 'Commercial credit, checkout, isolation and quota checks passed; fixtures roll back' as result;
