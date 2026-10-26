-- Disposable verification: all records and activity are rolled back.
begin;
do $$
declare company uuid; other_company uuid; po uuid; changed integer;
begin
  insert into public.companies(name) values ('PO verification') returning id into company;
  insert into public.companies(name) values ('PO verification second company') returning id into other_company;
  insert into public.purchase_orders(company_id,reference,total_minor,document)
  values(company,'TEST-PO',3897,'{"reference":"TEST-PO","status":"draft","currency":"USD","orderDate":"2026-10-26","deliveryDate":"","shippingAddress":"Original address","items":[{"description":"Filament","sku":"PLA","quantity":3,"unitPriceMinor":1299}]}') returning id into po;
  if not exists(select 1 from public.events where company_id=company and type='purchase_order_created') then raise exception 'Missing PO activity'; end if;
  begin
    insert into public.purchase_orders(company_id,reference,total_minor,document)
    select company_id,' test-po ',total_minor,jsonb_set(document,'{reference}','" test-po "') from public.purchase_orders where id=po;
    raise exception 'Duplicate PO accepted';
  exception when unique_violation then null;
  end;
  update public.purchase_orders set version=2, document=jsonb_set(document,'{status}','"confirmed"') where id=po and company_id=company and version=1;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'PO update failed'; end if;
  update public.purchase_orders set version=3 where id=po and company_id=company and version=1;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Stale update accepted'; end if;
  update public.purchase_orders set version=3 where id=po and company_id=other_company and version=2;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Cross-company update accepted'; end if;
  if not exists(select 1 from public.purchase_orders where id=po and document->>'shippingAddress'='Original address') then raise exception 'Shipping snapshot lost'; end if;
  if not exists(select 1 from public.events where company_id=company and type='purchase_order_updated') then raise exception 'Missing update activity'; end if;
  if has_table_privilege('anon','public.purchase_orders','SELECT') or has_table_privilege('authenticated','public.purchase_orders','UPDATE') then raise exception 'Direct client access exposed'; end if;
  if not (select relrowsecurity from pg_class where oid='public.purchase_orders'::regclass) then raise exception 'RLS disabled'; end if;
end;
$$;
rollback;
