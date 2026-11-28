-- Run inside a transaction and roll back; only synthetic users/workspaces.
do $$
declare actor uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); w uuid; other_w uuid; o jsonb; retry jsonb; e jsonb;
 code text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 denied boolean; before_count integer; end_at timestamptz;
begin
 if has_table_privilege('authenticated','crm_billing.subscription_discounts','select')
  or has_function_privilege('crm_workspace_server','public.redeem_subscription_discount(uuid,uuid,text,text,integer,text,text)','execute')
  or has_function_privilege('anon','public.check_subscription_discount(uuid,uuid,text)','execute')
 then raise exception 'FAIL: discount access is not private'; end if;
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 values(actor,'authenticated','authenticated','subscription-'||actor||'@example.invalid',now(),'{}','{}',now(),now()),
 (stranger,'authenticated','authenticated','subscription-'||stranger||'@example.invalid',now(),'{}','{}',now(),now());
 insert into crm_billing.subscription_discounts(code_hash,user_id) values(code,actor);
 denied:=false;
 begin perform public.redeem_subscription_discount(stranger,null,'Test','business',1,'FZ'||replace(gen_random_uuid()::text,'-',''),code); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: different account accepted'; end if;
 denied:=false;
 begin perform public.redeem_subscription_discount(actor,null,'Test','business',0,'FZ'||replace(gen_random_uuid()::text,'-',''),code); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: invalid billing period'; end if;
 update auth.users set email_confirmed_at=null where id=actor;
 denied:=false;
 begin perform public.redeem_subscription_discount(actor,null,'Test','business',1,'FZ'||replace(gen_random_uuid()::text,'-',''),code); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: unverified account accepted'; end if;
 update auth.users set email_confirmed_at=now() where id=actor;
 update crm_billing.subscription_discounts set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where code_hash=code;
 denied:=false;
 begin perform public.redeem_subscription_discount(actor,null,'Test','business',1,'FZ'||replace(gen_random_uuid()::text,'-',''),code); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: expired code accepted'; end if;
 update crm_billing.subscription_discounts set expires_at=now()+interval '30 days',revoked_at=now() where code_hash=code;
 denied:=false;
 begin perform public.redeem_subscription_discount(actor,null,'Test','business',1,'FZ'||replace(gen_random_uuid()::text,'-',''),code); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: revoked code accepted'; end if;
 update crm_billing.subscription_discounts set revoked_at=null where code_hash=code;
 -- Test the same restricted role used by the application, not just postgres.
 perform set_config('role','service_role',true);
 perform public.check_subscription_discount(actor,null,code);
 o:=public.redeem_subscription_discount(actor,null,'Subscription discount test','business',12,'FZ'||replace(gen_random_uuid()::text,'-',''),code);
 w:=(o->>'workspace_id')::uuid;
 if o->>'status'<>'paid' or (o->>'amount_fen')::integer<>0 or (o->>'discount_amount_fen')::integer<>934800
  or o->>'subscription_discount_id' is null or o->>'alipay_trade_no' is not null
 then raise exception 'FAIL: incorrect discounted order: %',o; end if;
 e:=crm_billing.entitlement(w);
 if not (e->>'active')::boolean or e->>'plan'<>'business' or (e->>'seats')::integer<>5
  or (e->>'credits')::bigint<>15000 or (e#>>'{limits,companies}')::integer<>20000
 then raise exception 'FAIL: wrong entitlements: %',e; end if;
 end_at:=(o->>'period_end')::timestamptz;
 if end_at is distinct from (o->>'period_start')::timestamptz+interval '12 months' then raise exception 'FAIL: wrong subscription period'; end if;
 retry:=public.redeem_subscription_discount(actor,null,'Subscription discount test','business',12,'FZ'||replace(gen_random_uuid()::text,'-',''),code);
 if retry->>'id'<>o->>'id' or (retry->>'period_end')::timestamptz<>end_at then raise exception 'FAIL: replay granted another period'; end if;
 denied:=false;
 begin perform public.check_subscription_discount(actor,w,code); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: used code previews as available'; end if;
 denied:=false;
 begin perform public.redeem_subscription_discount(actor,null,'Test','starter',1,'FZ'||replace(gen_random_uuid()::text,'-',''),code); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: code reused for another plan'; end if;
 perform set_config('role','postgres',true);
 if (select count(*) from public.subscription_orders where workspace_id=w and status='paid')<>1 then raise exception 'FAIL: duplicate paid order'; end if;
 if (select count(*) from crm_billing.credit_grants where workspace_id=w and kind='included')<>12
  or (crm_billing.credit_balance(w)->>'remainingMicros')::bigint<>15000000 then raise exception 'FAIL: wrong monthly credit grants'; end if;
 denied:=false;
 begin update public.subscription_orders set discount_amount_fen=1 where id=(o->>'id')::uuid; exception when check_violation then denied:=true; end;
 if not denied then raise exception 'FAIL: catalog discount tampering'; end if;
 -- A code must not rewrite an already-created Alipay quote, and a failed
 -- redemption must leave its code unused and its existing order unchanged.
 code:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into crm_billing.subscription_discounts(code_hash,user_id) values(code,actor);
 o:=public.create_current_package_subscription_order(actor,w,'Test','business',5,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),1);
 before_count:=(select count(*) from public.subscription_orders where workspace_id=w);
 perform set_config('role','service_role',true);
 denied:=false;
 begin perform public.redeem_subscription_discount(actor,w,'Test','business',1,'FZ'||replace(gen_random_uuid()::text,'-',''),code); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: pending payment quote overwritten'; end if;
 perform set_config('role','postgres',true);
 if (select count(*) from public.subscription_orders where workspace_id=w)<>before_count
  or exists(select 1 from crm_billing.subscription_discounts where code_hash=code and redeemed_order_id is not null)
  or (select amount_fen from public.subscription_orders where id=(o->>'id')::uuid)<>92900
 then raise exception 'FAIL: failed redemption changed billing'; end if;
 -- Ownership is rechecked at redemption, even after a successful preview.
 update public.workspaces set owner_id=stranger where id=w;
 denied:=false;
 begin perform public.redeem_subscription_discount(actor,w,'Test','business',1,'FZ'||replace(gen_random_uuid()::text,'-',''),code); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'FAIL: former owner redeemed code'; end if;
end $$;
select 'subscription discount verification passed' as result;
