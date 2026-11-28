-- Synthetic package/resource writes only. Always roll back the transaction.
do $$
declare item record; actor uuid; w uuid; o jsonb; e jsonb; balance jsonb; denied boolean;
begin
 for item in select * from (values
  ('starter',1,13900,2000,1000,100,1,5,1000,1000000000::bigint),
  ('pro',2,42900,6000,5000,500,3,15,5000,5000000000::bigint),
  ('business',5,92900,15000,20000,2000,5,50,20000,20000000000::bigint)
 ) p(plan,seats,price,credits,companies,products,mailboxes,flows,emails,bytes) loop
  actor:=gen_random_uuid();
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(actor,actor||'@resource-quota.invalid',now(),'{}');
  o:=public.create_current_package_subscription_order(actor,null,'Resource limits test',item.plan,item.seats,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),1);
  w:=(o->>'workspace_id')::uuid;
  perform public.confirm_subscription_payment(o->>'out_trade_no',(202611280000000200::bigint+item.seats)::text,item.price,'TRADE_SUCCESS');
  e:=crm_billing.entitlement(w);
  if e->'limits'<>jsonb_build_object('companies',item.companies,'products',item.products,'mailboxes',item.mailboxes,'flows',item.flows,'workflowEmails',item.emails,'documentBytes',item.bytes)
   then raise exception 'FAIL: mismatched advertised limits for %: %',item.plan,e; end if;
  balance:=crm_billing.credit_balance(w);
  if (balance->>'remainingMicros')::bigint<>item.credits*1000 then raise exception 'FAIL: incorrect shared AI credits'; end if;
  perform set_config('crm.workspace_id',w::text,true);
  perform set_config('role','crm_workspace_server',true);
  if (public.reserve_ai_budget(actor,'google/gemini-2.5-flash-lite',item.credits*1000+1)->>'allowed')::boolean then raise exception 'FAIL: AI credit cap not enforced'; end if;
  insert into public.products(workspace_id,sku,name) select w,'boundary-'||i,'Fixture product '||i from generate_series(1,item.products) i;
  denied:=false;
  begin insert into public.products(workspace_id,sku,name) values(w,'boundary-over','Over limit'); exception when raise_exception then denied:=sqlerrm like '%Plan limit reached: products%'; end;
  if not denied then raise exception 'FAIL: % product cap',item.plan; end if;
  -- Editing and idempotent import/upsert at the limit remain usable.
  insert into public.products(workspace_id,sku,name) values(w,'boundary-1','Updated fixture') on conflict(workspace_id,sku) do update set name=excluded.name;
  delete from public.products where workspace_id=w and sku='boundary-1';
  insert into public.products(workspace_id,sku,name) values(w,'boundary-replacement','Replacement fixture');
  insert into public.workspace_mailboxes(workspace_id,user_id,type,email,display_name)
   select w,actor,'personal','mailbox-'||i||'@resource-quota.invalid','Fixture mailbox '||i from generate_series(1,item.mailboxes) i;
  denied:=false;
  begin insert into public.workspace_mailboxes(workspace_id,user_id,type,email) values(w,actor,'personal','over@resource-quota.invalid'); exception when raise_exception then denied:=sqlerrm like '%Plan limit reached: mailboxes%'; end;
  if not denied then raise exception 'FAIL: % mailbox cap',item.plan; end if;
  insert into public.flows(workspace_id,user_id,name,trigger_type,created_by)
   select w,actor,'Fixture flow '||i,'new_lead',actor from generate_series(1,item.flows) i;
  denied:=false;
  begin insert into public.flows(workspace_id,user_id,name,trigger_type,created_by) values(w,actor,'Over limit','new_lead',actor); exception when raise_exception then denied:=sqlerrm like '%Plan limit reached: flows%'; end;
  if not denied then raise exception 'FAIL: % saved workflow cap',item.plan; end if;
  if item.plan='starter' then
   -- Same shared company trigger for all tiers; exercise the actual Starter boundary.
   insert into public.companies(workspace_id,name) select w,'Fixture company '||i from generate_series(1,item.companies) i;
   denied:=false;
   begin insert into public.companies(workspace_id,name) values(w,'Over limit'); exception when raise_exception then denied:=sqlerrm like '%Plan limit reached: companies%'; end;
   if not denied then raise exception 'FAIL: company cap'; end if;
  end if;
  perform set_config('role','postgres',true);
  -- Metadata fixtures test storage accounting without uploading any real files.
  insert into storage.objects(bucket_id,name,metadata) values('workspace-documents',w||'/boundary-fixture',jsonb_build_object('size',item.bytes));
  denied:=false;
  begin insert into storage.objects(bucket_id,name,metadata) values('workspace-documents',w||'/boundary-over',jsonb_build_object('size',1)); exception when raise_exception then denied:=sqlerrm like '%Plan limit reached: document storage%'; end;
  if not denied then raise exception 'FAIL: % document storage cap',item.plan; end if;
  update storage.objects set metadata=jsonb_build_object('size',item.bytes-1) where bucket_id='workspace-documents' and name=w||'/boundary-fixture';
  insert into storage.objects(bucket_id,name,metadata) values('workspace-documents',w||'/boundary-freed',jsonb_build_object('size',1));
 end loop;
end $$;
select 'Current packages: catalog, shared AI credits, products, mailboxes, saved workflows, Starter company limit and storage boundaries passed' as result;
