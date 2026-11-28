-- Run inside a transaction ending in ROLLBACK. No real payments or lasting grants.
do $$
declare actor uuid:=gen_random_uuid(); other_actor uuid:=gen_random_uuid(); w uuid; other_workspace uuid;
 initial jsonb; discount uuid; request uuid:=gen_random_uuid(); result jsonb; before_balance bigint; denied boolean;
 code text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
begin
 if has_function_privilege('anon','public.check_credit_discount(uuid,uuid,text)','execute')
 or has_function_privilege('authenticated','public.redeem_credit_discount(uuid,uuid,text,bigint,uuid)','execute')
 or has_function_privilege('crm_workspace_server','public.redeem_credit_discount(uuid,uuid,text,bigint,uuid)','execute')
 or has_table_privilege('authenticated','crm_billing.credit_discounts','select')
 or has_table_privilege('crm_workspace_server','crm_billing.credit_discount_redemptions','insert') then raise exception 'FAIL: discount privileges'; end if;
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 values(actor,'authenticated','authenticated','discount-'||actor||'@example.invalid',now(),'{}','{}',now(),now()),
 (other_actor,'authenticated','authenticated','discount-'||other_actor||'@example.invalid',now(),'{}','{}',now(),now());
 initial:=public.create_package_subscription_order(actor,null,'Discount fixture','starter',1,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),1);
 w:=(initial->>'workspace_id')::uuid;
 result:=public.create_package_subscription_order(other_actor,null,'Other discount fixture','starter',1,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),1);
 other_workspace:=(result->>'workspace_id')::uuid;
 insert into crm_billing.credit_discounts(code_hash,user_id,workspace_id) values(code,actor,w) returning id into discount;
 denied:=false;
 begin perform public.redeem_credit_discount(actor,w,code,3000,request); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: inactive workspace accepted'; end if;
 perform public.confirm_subscription_payment(initial->>'out_trade_no','202611280000000090',(initial->>'amount_fen')::integer,'TRADE_SUCCESS');
 before_balance:=(crm_billing.credit_balance(w)->>'remainingMicros')::bigint;
 if public.check_credit_discount(actor,w,code)->>'discountPercent'<>'100' then raise exception 'FAIL: discount'; end if;
 result:=public.redeem_credit_discount(actor,w,code,3000,request);
 perform public.redeem_credit_discount(actor,w,code,3000,request);
 if (crm_billing.credit_balance(w)->>'remainingMicros')::bigint<>before_balance+3000000 then raise exception 'FAIL: replay duplicated grant'; end if;
 perform public.redeem_credit_discount(actor,w,code,12345,gen_random_uuid());
 if (crm_billing.credit_balance(w)->>'remainingMicros')::bigint<>before_balance+15345000 then raise exception 'FAIL: repeat code did not grant chosen credits'; end if;
 if (select count(*) from crm_billing.credit_discount_redemptions where discount_id=discount)<>2 then raise exception 'FAIL: redemption audit'; end if;
 if exists(select 1 from crm_billing.credit_grants where workspace_id=w and source like 'discount:%' and expires_at<>starts_at+interval '1 year') then raise exception 'FAIL: grant expiry'; end if;
 denied:=false;
 begin perform public.redeem_credit_discount(actor,w,code,1,request); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: replay quantity changed'; end if;
 denied:=false;
 begin perform public.redeem_credit_discount(other_actor,w,code,3000,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: other account accepted'; end if;
 denied:=false;
 begin perform public.redeem_credit_discount(actor,other_workspace,code,3000,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: other workspace accepted'; end if;
 denied:=false;
 begin perform public.redeem_credit_discount(actor,w,repeat('0',64),3000,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: unknown code accepted'; end if;
 denied:=false;
 begin perform public.redeem_credit_discount(actor,w,code,0,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: invalid quantity'; end if;
 denied:=false;
 begin perform public.redeem_credit_discount(actor,w,code,9007199254741,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: unsafe credit precision'; end if;
 update public.workspaces set owner_id=other_actor where id=w;
 denied:=false;
 begin perform public.redeem_credit_discount(actor,w,code,3000,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: former owner accepted'; end if;
 update public.workspaces set owner_id=actor where id=w;
 update auth.users set email_confirmed_at=null where id=actor;
 denied:=false;
 begin perform public.redeem_credit_discount(actor,w,code,3000,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: unverified email accepted'; end if;
 update auth.users set email_confirmed_at=now() where id=actor;
 update crm_billing.credit_discounts set revoked_at=now() where id=discount;
 denied:=false;
 begin perform public.redeem_credit_discount(actor,w,code,3000,gen_random_uuid()); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL: revoked code accepted'; end if;
end $$;
select 'discount database verification passed' as result;
