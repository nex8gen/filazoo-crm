-- All fixtures, activity and changes roll back.
begin;
set local role service_role;
do $$
declare company uuid; po uuid; inv uuid; doc jsonb; line jsonb; invoice_doc jsonb; bad jsonb; field text;
begin
  insert into public.companies(name) values('PO product rollback verification') returning id into company;
  insert into public.products(sku,name,currency,price,moq) values('PO-ROLLBACK-PRODUCT','Test filament','USD',10,5);
  line := '{"description":"Test filament","sku":"PO-ROLLBACK-PRODUCT","productSku":"PO-ROLLBACK-PRODUCT","pricingMode":"catalog","quantity":10,"unitPriceMinor":1000,"imageUrl":"/catalog-default-product.jpg"}';
  doc := jsonb_build_object('reference','PO-PRODUCT-TEST','status','confirmed','currency','USD','items',jsonb_build_array(line));
  insert into public.purchase_orders(company_id,reference,total_minor,document)
    values(company,'PO-PRODUCT-TEST',10000,doc) returning id into po;
  begin
    update public.purchase_orders set total_minor=99 where id=po;
    raise exception 'TEST FAILED: incorrect total accepted';
  exception when raise_exception then if sqlerrm not like 'Purchase order total%' then raise; end if; end;
  begin
    update public.purchase_orders set document=jsonb_set(document,'{currency}','"EUR"') where id=po;
    raise exception 'TEST FAILED: mixed currency accepted';
  exception when raise_exception then if sqlerrm not like 'Product currency%' then raise; end if; end;
  begin
    update public.purchase_orders set document=jsonb_set(document,'{items,0,productSku}','"MISSING-PRODUCT"') where id=po;
    raise exception 'TEST FAILED: nonexistent product accepted';
  exception when raise_exception then if sqlerrm not like 'Product % is unavailable.%' then raise; end if; end;
  begin
    update public.purchase_orders set document=document #- '{items,0,pricingMode}' where id=po;
    raise exception 'TEST FAILED: ambiguous pricing accepted';
  exception when raise_exception then if sqlerrm not like 'Choose catalog pricing%' then raise; end if; end;
  begin
    update public.purchase_orders set document=jsonb_set(document,'{items,0,quantity}','1'),total_minor=1000 where id=po;
    raise exception 'TEST FAILED: below MOQ catalog quantity accepted';
  exception when raise_exception then if sqlerrm not like 'The product minimum quantity%' then raise; end if; end;
  begin
    update public.purchase_orders set document=jsonb_set(document,'{items,0,sku}','"WRONG"') where id=po;
    raise exception 'TEST FAILED: wrong SKU accepted';
  exception when raise_exception then if sqlerrm not like 'The SKU must match%' then raise; end if; end;
  update public.products set active=false where sku='PO-ROLLBACK-PRODUCT';
  update public.purchase_orders set document=jsonb_set(document,'{status}','"in_production"') where id=po;
  if not exists(select 1 from public.purchase_orders where id=po and document->'items'->0=line) then raise exception 'TEST FAILED: historical snapshot lost'; end if;
  begin
    update public.purchase_orders set document=jsonb_set(document,'{items,0,quantity}','11'),total_minor=11000 where id=po;
    raise exception 'TEST FAILED: changed inactive product accepted';
  exception when raise_exception then if sqlerrm not like 'Product % is unavailable.%' then raise; end if; end;
  -- Historical agreed products can still be invoiced after catalog deactivation.
  invoice_doc := jsonb_build_object('companyId',company,'purchaseOrderId',po,'reference','PO-PRODUCT-TEST','currency','USD',
    'customerName','ROLLBACK','sellerName','Filazoo','items',jsonb_build_array((line - 'sku') || '{"purchaseOrderLineId":"line-1","pricingMode":"manual","taxBps":0}'));
  insert into public.invoices(number,document,total_minor) overriding system value values(-92001,invoice_doc,10000) returning id into inv;
  foreach field in array array['productSku','variantId','variantSku','imageUrl','pricingMode'] loop
    bad := jsonb_set(invoice_doc,array['items','0',field],'"forged"');
    begin
      update public.invoices set document=bad where id=inv;
      raise exception 'TEST FAILED: forged invoice product metadata accepted';
    exception when raise_exception then if sqlerrm not like 'Invoice product, variant%' then raise; end if; end;
  end loop;
  begin
    update public.invoices set document=document #- '{items,0,productSku}' where id=inv;
    raise exception 'TEST FAILED: removed product link accepted';
  exception when raise_exception then if sqlerrm not like 'Invoice product, variant%' then raise; end if; end;
  if has_function_privilege('anon','public.guard_purchase_order_products()','EXECUTE')
    or has_function_privilege('authenticated','public.guard_order_invoice_products()','EXECUTE') then
    raise exception 'TEST FAILED: guards exposed to public clients';
  end if;
end;
$$;
rollback;
