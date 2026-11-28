-- Roll back the surrounding transaction/savepoint: synthetic records only.
do $$
declare actor uuid:=gen_random_uuid(); old_actor uuid:=gen_random_uuid(); w uuid; old_w uuid; f uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); r2 uuid:=gen_random_uuid();
 o jsonb; old_order jsonb; e jsonb; result jsonb; denied boolean; period date:=date_trunc('month',now() at time zone 'Asia/Shanghai')::date;
begin
 if has_function_privilege('authenticated','public.reserve_workflow_email(uuid,text)','execute')
  or has_function_privilege('anon','public.finish_workflow_email(uuid,text,text)','execute')
  or has_table_privilege('crm_workspace_server','crm_billing.workflow_email_deliveries','insert')
 then raise exception 'FAIL: browser or tenant can forge email usage'; end if;
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 values(actor,'authenticated','authenticated','workflow-quota-'||actor||'@example.invalid',now(),'{}','{}',now(),now()),
 (old_actor,'authenticated','authenticated','workflow-quota-'||old_actor||'@example.invalid',now(),'{}','{}',now(),now());
 o:=public.create_current_package_subscription_order(actor,null,'New package test','starter',1,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),12);
 w:=(o->>'workspace_id')::uuid;
 if (o->>'catalog_version')::integer<>6 or (o->>'amount_fen')::integer<>130800 then raise exception 'FAIL: new catalog/order pricing'; end if;
 perform public.confirm_subscription_payment(o->>'out_trade_no','202611280000000011',130800,'TRADE_SUCCESS');
 e:=crm_billing.entitlement(w);
 if e#>>'{limits,products}'<>'100' or e#>>'{limits,flows}'<>'5' or e#>>'{limits,workflowEmails}'<>'1000'
  or e#>'{limits,flowRuns}' is not null or (crm_billing.credit_balance(w)->>'remainingMicros')::bigint<>2000000
 then raise exception 'FAIL: wrong package limits or multiplied credit allowance: %',e; end if;
 if (select count(*) from crm_billing.credit_grants where workspace_id=w and kind='included')<>12 then raise exception 'FAIL: annual monthly credit grants'; end if;
 old_order:=public.create_package_subscription_order(old_actor,null,'Old package test','business',5,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),1);
 old_w:=(old_order->>'workspace_id')::uuid;
 perform public.confirm_subscription_payment(old_order->>'out_trade_no','202611280000000012',92900,'TRADE_SUCCESS');
 e:=crm_billing.entitlement(old_w);
 if e#>>'{limits,products}'<>'25000' or e#>>'{limits,companies}'<>'50000' or e->>'catalogVersion'<>'4'
  or (crm_billing.credit_balance(old_w)->>'remainingMicros')::bigint<>15000000
 then raise exception 'FAIL: historical entitlements changed'; end if;
 perform set_config('crm.workspace_id',w::text,true);
 perform set_config('role','crm_workspace_server',true);
 insert into public.products(workspace_id,sku,name) select w,'quota-product-'||i,'Fixture product '||i from generate_series(1,100) i;
 denied:=false;
 begin insert into public.products(workspace_id,sku,name) values(w,'quota-over','Over limit'); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: new product cap not enforced'; end if;
 insert into public.flows(id,workspace_id,user_id,name,trigger_type,created_by) values(f,w,actor,'Quota test','new_lead',actor);
 insert into public.flow_runs(workspace_id,flow_id,conversation_id,status) select w,f,'quota-start-'||i,'done' from generate_series(1,1001) i;
 if (select count(*) from public.flow_runs where workspace_id=w)<>1001 then raise exception 'FAIL: workflow starts still limited'; end if;
 insert into public.flow_runs(id,workspace_id,flow_id,conversation_id,status,context) values
 (r,w,f,'quota-mail-1','active','{"executionCheckpoint":{"stepId":"send-1","type":"send_email","phase":"preparing"}}'),
 (r2,w,f,'quota-mail-2','active','{"executionCheckpoint":{"stepId":"send-2","type":"ai_auto_reply","phase":"preparing"}}');
 denied:=false;
 begin perform public.reserve_workflow_email(r,'forged-step'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: wrong action reserved'; end if;
 perform set_config('role','postgres',true);
 insert into crm_billing.workflow_email_deliveries(workspace_id,run_id,step_id,period_start,state,sent_at)
 select w,gen_random_uuid(),'history-'||i,period,'sent',now() from generate_series(1,999) i;
 perform set_config('role','crm_workspace_server',true);
 result:=public.reserve_workflow_email(r,'send-1');
 if result->>'state'<>'reserved' then raise exception 'FAIL: last slot denied'; end if;
 if public.reserve_workflow_email(r,'send-1')->>'state'<>'pending' then raise exception 'FAIL: reserved action replayed'; end if;
 if public.reserve_workflow_email(r2,'send-2')->>'state'<>'limited' then raise exception 'FAIL: concurrent reserved slot not counted'; end if;
 perform public.finish_workflow_email(r,'send-1','sent');
 perform public.finish_workflow_email(r,'send-1','sent');
 result:=public.read_billing_overview(actor);
 if result#>>'{usage,workflowEmails}'<>'1000' then raise exception 'FAIL: accepted sends missing/double counted'; end if;
 denied:=false;
 begin perform public.finish_workflow_email(r,'send-1','released'); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: accepted quota reversed'; end if;
 delete from public.flow_runs where id=r;
 if public.read_billing_overview(actor)#>>'{usage,workflowEmails}'<>'1000' then raise exception 'FAIL: deleting run history reset email usage'; end if;
 perform set_config('role','postgres',true);
 update crm_billing.workflow_email_deliveries set period_start=(period-interval '1 month')::date where workspace_id=w;
 perform set_config('role','crm_workspace_server',true);
 if public.reserve_workflow_email(r2,'send-2')->>'state'<>'reserved' then raise exception 'FAIL: calendar month did not reset'; end if;
 perform public.finish_workflow_email(r2,'send-2','released');
 if public.read_billing_overview(actor)#>>'{usage,workflowEmails}'<>'0' then raise exception 'FAIL: failed sends counted as sent'; end if;
 if public.reserve_workflow_email(r2,'send-2')->>'state'<>'reserved' then raise exception 'FAIL: safe retry cannot reuse released reservation'; end if;
 perform public.finish_workflow_email(r2,'send-2','uncertain');
 if public.reserve_workflow_email(r2,'send-2')->>'state'<>'uncertain' then raise exception 'FAIL: uncertain email may be resent'; end if;
 denied:=false;
 begin perform public.finish_workflow_email(r2,'send-2','released'); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: uncertain submission freed capacity'; end if;
 perform set_config('crm.workspace_id',old_w::text,true);
 denied:=false;
 begin perform public.reserve_workflow_email(r2,'send-2'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: other workspace reserved'; end if;
 denied:=false;
 begin perform public.finish_workflow_email(r2,'send-2','sent'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: other workspace settled'; end if;
 perform set_config('role','postgres',true);
end $$;
select 'workflow email package verification passed' as result;
