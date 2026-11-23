-- Run in a transaction ending in rollback. No provider calls or real payments.
do $$
declare actor uuid; w uuid; o jsonb; c uuid; e jsonb; r jsonb; pending jsonb; item record; grant_id uuid; denied boolean; member uuid; i integer;
begin
 for item in select * from (values ('starter',1,2000),('pro',2,6000),('business',5,15000)) as p(plan,seats,credits) loop
  actor:=gen_random_uuid();
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
   values(actor,'authenticated','authenticated','gift-package-'||actor||'@example.invalid',now(),'{}','{}',now(),now());
  o:=public.create_commercial_order(actor,null,'Gift package fixture','starter',1,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''));
  w:=(o->>'workspace_id')::uuid;
  update public.subscription_orders set status='closed' where id=(o->>'id')::uuid;
  insert into crm_billing.complimentary_subscriptions(workspace_id,plan_id,seats,reason)
   values(w,'business',6,'Rolled-back package conversion') returning id into c;
  update public.ai_budget_policy set credit_only=true where workspace_id=w;
  perform set_config('crm.workspace_id',w::text,true); perform set_config('role','crm_workspace_server',true);
  r:=public.reserve_ai_budget(actor,'google/gemini-2.5-flash-lite',1000);
  perform public.settle_ai_budget(actor,(r->>'reservationId')::uuid,500);
  pending:=public.reserve_ai_budget(actor,'google/gemini-2.5-flash-lite',2000);
  perform set_config('role','none',true);
  select id into strict grant_id from crm_billing.credit_grants where workspace_id=w and kind='included';
  update crm_billing.complimentary_subscriptions set plan_id=item.plan,seats=item.seats,catalog_version=4 where id=c;
  perform crm_billing.sync_included_credits(w); perform crm_billing.sync_included_credits(w);
  e:=crm_billing.entitlement(w);
  if e->'limits' is distinct from crm_billing.package_catalog_v4(item.plan)->'limits' or (e->>'seats')::int<>item.seats or (e->>'credits')::int<>item.credits then raise exception 'FAIL: complimentary package multiplied: %',e; end if;
  e:=crm_billing.credit_balance(w);
  if (e->>'includedMicros')::bigint<>item.credits*1000 or (e->>'usedMicros')::bigint<>2500 or (e->>'remainingMicros')::bigint<>item.credits*1000-2500 then raise exception 'FAIL: conversion lost settled/pending usage: %',e; end if;
  if (select count(*) from crm_billing.credit_grants where workspace_id=w)<>1 or not exists(select 1 from crm_billing.credit_grants where id=grant_id and amount_micros=item.credits*1000) then raise exception 'FAIL: duplicate/replaced monthly grant'; end if;
  if (public.read_complimentary_subscription(w)->>'catalogVersion')::int<>4 then raise exception 'FAIL: subscription status uses old catalog'; end if;
  denied:=false;
  begin update crm_billing.complimentary_subscriptions set seats=item.seats+1 where id=c; exception when check_violation then denied:=true; end;
  if not denied then raise exception 'FAIL: arbitrary package seat count accepted'; end if;
  denied:=false;
  begin perform public.create_package_subscription_order(actor,w,'Unused',item.plan,item.seats,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),1); exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'FAIL: complimentary package charged'; end if;
  perform set_config('role','crm_workspace_server',true);
  perform public.settle_ai_budget(actor,(pending->>'reservationId')::uuid,1000);
  e:=public.read_billing_overview(actor);
  if e->>'complimentary'<>'true' or (e#>>'{credits,usedMicros}')::bigint<>1500 or (e#>>'{credits,includedMicros}')::bigint<>item.credits*1000 then raise exception 'FAIL: overview or pending settlement uses legacy allowance'; end if;
  r:=public.reserve_ai_budget(actor,'google/gemini-2.5-flash-lite',item.credits*1000-1500+1);
  if r->>'allowed'<>'false' or r->>'reason'<>'credits_exhausted' then raise exception 'FAIL: package credit cap ignored'; end if;
  perform set_config('role','none',true);
  -- Existing inactive members survive a conversion, but cannot exceed package seats on activation.
  update crm_billing.complimentary_subscriptions set catalog_version=2,seats=6 where id=c;
  for i in 2..item.seats+1 loop
   member:=gen_random_uuid();
   insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
    values(member,'authenticated','authenticated','gift-member-'||member||'@example.invalid',now(),'{}','{}',now(),now());
   insert into public.workspace_members(workspace_id,user_id,role,activated_at) values(w,member,'operator',case when i<=item.seats then now() else null end);
  end loop;
  update crm_billing.complimentary_subscriptions set catalog_version=4,seats=item.seats where id=c;
  denied:=false;
  begin update public.workspace_members set activated_at=now() where workspace_id=w and user_id=member; exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'FAIL: inactive extra member activated above package capacity'; end if;
  if (select count(*) from public.workspace_members where workspace_id=w)<>item.seats+1 then raise exception 'FAIL: conversion removed member records'; end if;
 end loop;
 if has_function_privilege('authenticated','public.read_complimentary_subscription(uuid)','execute') or has_table_privilege('crm_workspace_server','crm_billing.complimentary_subscriptions','update') then raise exception 'FAIL: private grant privileges changed'; end if;
end $$;
select 'Complimentary package quotas, wallet preservation, checkout protection and activation limits passed' as result;
