begin;
set local role service_role;
do $$
declare company uuid; other_company uuid; po uuid; custom_po uuid; inv uuid; second_inv uuid; doc jsonb; invoice_doc jsonb;
begin
  insert into public.companies(name) values('Order invoice rollback verification') returning id into company;
  insert into public.companies(name) values('Other rollback company') returning id into other_company;
  doc := '{"reference":"CONNECT-TEST","status":"draft","currency":"USD","orderDate":"2026-10-26","deliveryDate":"","shippingAddress":"Original ship-to","items":[{"description":"Filament","sku":"PLA","quantity":10,"unitPriceMinor":10000}]}';
  insert into public.purchase_orders(company_id,reference,total_minor,document) values(company,'CONNECT-TEST',100000,doc) returning id into po;
  invoice_doc := jsonb_build_object('companyId',company,'purchaseOrderId',po,'reference','CONNECT-TEST','currency','USD','customerName','ROLLBACK','sellerName','Filazoo','items',jsonb_build_array(jsonb_build_object('description','Filament','purchaseOrderLineId','line-1','quantity',6,'unitPriceMinor',10000,'taxBps',0)));
  begin
    insert into public.invoices(number,document,total_minor) overriding system value values(-91001,invoice_doc,60000);
    raise exception 'TEST FAILED: invoiced unconfirmed order';
  exception when raise_exception then if sqlerrm not like 'Confirm the customer order%' then raise; end if; end;
  update public.purchase_orders set document=jsonb_set(document,'{status}','"confirmed"') where id=po;
  insert into public.invoices(number,document,total_minor) overriding system value values(-91001,invoice_doc,60000) returning id into inv;
  if not exists(select 1 from public.invoices where id=inv and purchase_order_id=po and company_id=company) then raise exception 'TEST FAILED: missing links'; end if;
  begin
    insert into public.invoices(number,document,total_minor) overriding system value values(-91002,jsonb_set(invoice_doc,'{items,0,quantity}','5'),50000);
    raise exception 'TEST FAILED: duplicate quantities accepted';
  exception when raise_exception then if sqlerrm not like 'This quantity is already%' then raise; end if; end;
  begin
    insert into public.invoices(number,document,total_minor) overriding system value values(-91002,jsonb_set(invoice_doc,'{companyId}',to_jsonb(other_company::text)),60000);
    raise exception 'TEST FAILED: cross-company link';
  exception when raise_exception then if sqlerrm not like 'Invoice customer and currency%' then raise; end if; end;
  begin
    update public.invoices set document=jsonb_set(document,'{currency}','"EUR"') where id=inv;
    raise exception 'TEST FAILED: currency mismatch';
  exception when raise_exception then if sqlerrm not like 'Invoice customer and currency%' then raise; end if; end;
  begin
    update public.purchase_orders set document=jsonb_set(document,'{items,0,unitPriceMinor}','12000') where id=po;
    raise exception 'TEST FAILED: changed billed prices';
  exception when raise_exception then if sqlerrm not like 'Order items, customer%' then raise; end if; end;
  begin
    update public.purchase_orders set document=jsonb_set(document,'{status}','"shipped"') where id=po;
    raise exception 'TEST FAILED: shipped with draft invoice';
  exception when raise_exception then if sqlerrm not like 'Invoice all order items%' then raise; end if; end;
  update public.invoices set status='issued',paid_minor=50000 where id=inv;
  insert into public.invoices(number,document,total_minor,status,paid_minor) overriding system value values(-91002,jsonb_set(invoice_doc,'{items,0,quantity}','4'),40000,'issued',40000) returning id into second_inv;
  begin
    update public.purchase_orders set document=jsonb_set(document,'{status}','"shipped"') where id=po;
    raise exception 'TEST FAILED: shipped before full payment';
  exception when raise_exception then if sqlerrm not like 'Payment required before shipment%' then raise; end if; end;
  update public.invoices set paid_minor=60000 where id=inv;
  update public.purchase_orders set document=jsonb_set(document,'{status}','"shipped"') where id=po;
  if not exists(select 1 from public.purchase_orders where id=po and document->>'status'='shipped') then raise exception 'TEST FAILED: paid shipment blocked'; end if;
  doc := doc || '{"reference":"CUSTOM-TEST","status":"confirmed","paymentPolicy":"custom","preShipmentPercent":30,"paymentTerms":"30% before shipment; balance later"}';
  insert into public.purchase_orders(company_id,reference,total_minor,document) values(company,'CUSTOM-TEST',100000,doc) returning id into custom_po;
  invoice_doc := invoice_doc || jsonb_build_object('purchaseOrderId',custom_po,'reference','CUSTOM-TEST');
  invoice_doc := jsonb_set(invoice_doc,'{items,0,quantity}','10');
  insert into public.invoices(number,document,total_minor,status,paid_minor) overriding system value values(-91003,invoice_doc,100000,'issued',30000);
  update public.purchase_orders set document=jsonb_set(document,'{status}','"shipped"') where id=custom_po;
  begin
    insert into public.purchase_orders(company_id,reference,total_minor,document) values(company,'BAD-TERMS',100000,(doc || '{"reference":"BAD-TERMS","paymentTerms":""}'));
    raise exception 'TEST FAILED: undocumented exception accepted';
  exception when raise_exception then if sqlerrm not like 'Describe the agreed payment terms%' then raise; end if; end;
end;
$$;
rollback;
