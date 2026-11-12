-- Rollback-only checks: no real customer document is edited or sent.
begin;
set local statement_timeout='30s';
do $$
declare tenant uuid; actor uuid; customer uuid; po uuid; inv uuid; entry uuid; receipt uuid; quote uuid; sku text; sample jsonb;
begin
  select workspace_id,company_id into tenant,customer from public.purchase_orders order by created_at limit 1;
  select owner_id into actor from public.workspaces where id=tenant;
  assert tenant is not null and actor is not null, 'Need an existing workspace and customer';
  perform set_config('crm.workspace_id',tenant::text,true);
  set local role crm_workspace_server;
  sample := '{"reference":"","status":"draft","currency":"USD","orderDate":"2026-11-11","deliveryDate":"","shippingAddress":"","shippingRecipient":"","shippingPhone":"","paymentPolicy":"full_before_shipment","preShipmentPercent":100,"paymentTerms":"","notes":"Library rollback test","items":[{"description":"Library verification","sku":"QA","quantity":1,"unitPriceMinor":100}]}';
  insert into public.purchase_orders(company_id,created_by,document,total_minor) values(customer,actor,sample,100) returning id into po;
  select id into inv from public.invoices where purchase_order_id=po and status='draft';
  assert inv is not null, 'Order must generate a draft invoice';
  select id into entry from public.library_documents where source_type='invoice' and source_id=inv and category='proforma' and purchase_order_id=po;
  assert entry is not null, 'Draft invoice must automatically appear in Draft invoices';
  assert exists(select 1 from public.library_documents where source_type='purchase_order' and source_id=po and company_id=customer), 'Order entry must be linked';
  update public.purchase_orders set document=jsonb_set(document,'{notes}','"Updated rollback-only notes"') where id=po;
  assert (select count(*)=1 from public.library_documents where source_type='invoice' and source_id=inv), 'Order edits must not duplicate files';
  update public.purchase_orders set document=jsonb_set(document,'{status}','"confirmed"') where id=po;
  update public.invoices set status='issued' where id=inv;
  assert exists(select 1 from public.library_documents where id=entry and category='invoice' and source_status='issued'), 'Issuing must move the SAME entry to commercial invoices';
  assert not exists(select 1 from public.library_documents where source_id=inv and category='proforma'), 'Issued invoice must leave draft category';
  insert into public.invoice_payments(id,invoice_id,amount_minor,paid_on,method,reference,created_by) values(gen_random_uuid(),inv,100,'2026-11-11','bank_transfer','Library QA',actor) returning id into receipt;
  assert exists(select 1 from public.library_documents where source_type='payment' and source_id=receipt and invoice_id=inv and purchase_order_id=po and category='payment'), 'Recorded payment must link to invoice and order';
  delete from public.invoice_payments where id=receipt;
  assert not exists(select 1 from public.library_documents where source_type='payment' and source_id=receipt), 'Removing receipt must remove its source entry';
  select p.sku into sku from public.products p where active and btrim(currency)='USD' limit 1;
  insert into public.catalogs(user_id,company_id,product_skus,product_snapshot,currency,version) values(actor,customer,array[sku],'[]','USD',1) returning id into quote;
  assert exists(select 1 from public.library_documents where source_type='quotation' and source_id=quote and company_id=customer and product_skus=array[sku] and created_by=actor), 'Quotation must link its customer, products and owner';
  delete from public.catalogs where id=quote;
  assert not exists(select 1 from public.library_documents where source_type='quotation' and source_id=quote), 'Deleted quotation must leave library';
  perform set_config('crm.workspace_id',gen_random_uuid()::text,true);
  assert not exists(select 1 from public.library_documents where id=entry), 'Library entries must remain isolated by workspace';
end $$;
rollback;
