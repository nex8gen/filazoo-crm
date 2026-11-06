begin;
create function public.limit_purchase_order_billing_fields() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.document ? 'billing' then
    new.document:=jsonb_set(new.document,'{billing}',coalesce((select jsonb_object_agg(key,value)
      from jsonb_each(new.document->'billing') where key in ('issueDate','dueDate','discountMinor','taxBps','paymentMethods')),'{}'));
  end if;
  return new;
end $$;
revoke all on function public.limit_purchase_order_billing_fields() from public,anon,authenticated;
grant execute on function public.limit_purchase_order_billing_fields() to service_role,crm_workspace_server;
create trigger purchase_orders_01_billing_fields before insert or update on public.purchase_orders
for each row execute function public.limit_purchase_order_billing_fields();
create or replace function public.sync_purchase_order_invoice() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
  inv public.invoices; settings jsonb; doc jsonb; customer jsonb; contact uuid;
  items jsonb := '[]'; line jsonb; prior_line jsonb; idx bigint; today text;
  subtotal bigint := 0; discount bigint; cumulative numeric := 0;
  allocated bigint := 0; target bigint; gross bigint; tax bigint := 0; total bigint;
begin
  if new.document->>'status'='cancelled' then
    delete from public.invoices where purchase_order_id=new.id and order_managed and status='draft';
    return new;
  end if;
  if exists(select 1 from public.invoices where purchase_order_id=new.id and status<>'void' and (status='issued' or not order_managed)) then
    return new;
  end if;
  select * into inv from public.invoices where purchase_order_id=new.id and order_managed and status='draft' for update;
  if tg_op='UPDATE' and inv.id is not null and
    (new.document - array['status','orderDate','deliveryDate','tags']) = (old.document - array['status','orderDate','deliveryDate','tags'])
    and not(inv.document ?| array['bankAccountId','bankAccount']) and coalesce(inv.document->>'paymentInstructions','')='' then
    return new;
  end if;
  select s.settings into settings from public.invoice_settings s where singleton and s.workspace_id=new.workspace_id;
  settings := coalesce(settings,'{}');
  today := to_char(now() at time zone 'Asia/Shanghai','YYYY-MM-DD');
  customer := new.document->'customer';
  if customer is null then
    select jsonb_build_object('companyName',c.name,'billingAddress',coalesce(p.profile->>'address',concat_ws(', ',c.city,c.country)),
      'billingEmail',coalesce(p.profile->>'email',''),'taxId',coalesce(p.profile->>'taxId',''))
      into customer from public.companies c left join public.customer_billing_profiles p on p.company_id=c.id and p.workspace_id=c.workspace_id where c.id=new.company_id and c.workspace_id=new.workspace_id;
  end if;
  select id into contact from public.contacts where company_id=new.company_id and workspace_id=new.workspace_id and id=nullif(customer->>'contactId','')::uuid;
  doc := coalesce(inv.document,jsonb_build_object(
    'sellerName',coalesce(nullif(settings->>'sellerName',''),'Filazoo'),
    'sellerAddress',coalesce(settings->>'sellerAddress',''),'sellerTaxId',coalesce(settings->>'sellerTaxId',''),
    'paymentInstructions',coalesce(settings->>'paymentInstructions',''),
    'issueDate',today,'dueDate',today,'discountMinor',0,'shippingMinor',0));
  if new.document ? 'billing' then
    doc := (doc - 'paymentMethods') || jsonb_strip_nulls(jsonb_build_object(
      'issueDate',new.document->'billing'->'issueDate','dueDate',new.document->'billing'->'dueDate',
      'discountMinor',new.document->'billing'->'discountMinor','paymentMethods',new.document->'billing'->'paymentMethods'));
    doc := jsonb_set(doc,'{shippingMinor}','0');
  end if;
  -- PO billing has no account, manual-instruction, or seller overrides.
  -- Standard invoice seller identity still comes from workspace settings.
  doc := (doc - array['bankAccountId','bankAccount']) || jsonb_build_object(
    'sellerName',coalesce(nullif(settings->>'sellerName',''),'Filazoo'),
    'sellerAddress',coalesce(settings->>'sellerAddress',''),'sellerTaxId',coalesce(settings->>'sellerTaxId',''),
    'paymentInstructions','');
  for line,idx in select value,ordinality from jsonb_array_elements(new.document->'items') with ordinality loop
    select x into prior_line from jsonb_array_elements(coalesce(inv.document->'items','[]')) x where x->>'purchaseOrderLineId'='line-'||idx::text;
    items := items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'description',line->>'description','quantity',(line->>'quantity')::bigint,'unitPriceMinor',(line->>'unitPriceMinor')::bigint,
      'taxBps',case when line->>'sku'='SHIPPING' and not(line ? 'productSku') then 0 else coalesce((new.document->'billing'->>'taxBps')::integer,(prior_line->>'taxBps')::integer,0) end,'purchaseOrderLineId','line-'||idx::text,
      'productSku',line->>'productSku','variantId',line->>'variantId','variantSku',line->>'variantSku',
      'imageUrl',line->>'imageUrl','pricingMode',case when line ? 'productSku' then 'manual' end)));
    subtotal := subtotal + (line->>'quantity')::bigint * (line->>'unitPriceMinor')::bigint;
  end loop;
  discount := coalesce((doc->>'discountMinor')::bigint,0);
  if discount>subtotal then raise exception 'The invoice discount exceeds the revised order subtotal. Adjust the invoice discount before saving this order.'; end if;
  for line in select * from jsonb_array_elements(items) loop
    gross := (line->>'quantity')::bigint * (line->>'unitPriceMinor')::bigint;
    cumulative := cumulative + gross;
    target := case when subtotal>0 then floor(discount::numeric*cumulative/subtotal) else 0 end;
    tax := tax + round((gross-(target-allocated))::numeric*(line->>'taxBps')::integer/10000);
    allocated := target;
  end loop;
  total := subtotal - discount + tax + coalesce((doc->>'shippingMinor')::bigint,0);
  if subtotal>100000000000 or total>200000000000 then raise exception 'The order exceeds the supported invoice maximum.'; end if;
  doc := (doc - 'contactId') || jsonb_strip_nulls(jsonb_build_object(
    'companyId',new.company_id,'purchaseOrderId',new.id,'reference',new.reference,'currency',new.document->>'currency',
    'customerName',customer->>'companyName','customerEmail',coalesce(nullif(customer->>'billingEmail',''),customer->>'contactEmail',''),
    'customerAddress',coalesce(customer->>'billingAddress',''),'customerTaxId',coalesce(customer->>'taxId',''),'contactId',contact,
    'shippingAddress',coalesce(new.document->>'shippingAddress',''),'shippingRecipient',coalesce(new.document->>'shippingRecipient',''),
    'shippingPhone',coalesce(new.document->>'shippingPhone',''),'items',items,
    'notes',left('Payment terms: ' || case when new.document->>'paymentPolicy'='custom' then
      (new.document->>'preShipmentPercent') || '% payment before shipment. ' || (new.document->>'paymentTerms')
      else '100% payment before shipment.' end || case when coalesce(new.document->>'notes','')<>'' then E'\n\n'||(new.document->>'notes') else '' end,4000)));
  -- Do not retain payment details from a different currency after a PO edit.
  if nullif(doc->'bankAccount'->>'currency','') is not null and doc->'bankAccount'->>'currency'<>new.document->>'currency' then
    doc := doc - array['bankAccount','bankAccountId'];
  end if;
  if doc ? 'paymentMethods' then
    doc := jsonb_set(doc,'{paymentMethods}',coalesce((select jsonb_agg(x) from jsonb_array_elements(doc->'paymentMethods') x
      where nullif(x->>'currency','') is null or x->>'currency'=new.document->>'currency'),'[]'));
  end if;
  if inv.id is null then
    insert into public.invoices(document,total_minor,created_by,order_managed,workspace_id)
      values(doc,total,coalesce(new.updated_by,new.created_by),true,new.workspace_id) returning * into inv;
    insert into public.invoice_events(invoice_id,actor_id,action,data,workspace_id)
      values(inv.id,coalesce(new.updated_by,new.created_by),'create',jsonb_build_object('purchaseOrderId',new.id,'automatic',true),new.workspace_id);
  elsif doc is distinct from inv.document or total<>inv.total_minor then
    update public.invoices set document=doc,total_minor=total,revision=revision+1,updated_at=now() where id=inv.id;
    insert into public.invoice_events(invoice_id,actor_id,action,data,workspace_id)
      values(inv.id,new.updated_by,'save',jsonb_build_object('purchaseOrderId',new.id,'automatic',true),new.workspace_id);
  end if;
  return new;
end;
$$;


create or replace function public.guard_order_fulfillment() returns trigger
language plpgsql security invoker set search_path='' as $$
declare required_percent integer; billed bigint; paid bigint; ordered jsonb; idx bigint; quantity bigint;
begin
  if tg_op='UPDATE' and exists(select 1 from public.invoices where purchase_order_id=old.id and status<>'void' and (status='issued' or not order_managed)) then
    if new.company_id<>old.company_id or new.reference<>old.reference or new.document->'currency' is distinct from old.document->'currency'
      or new.document->'items' is distinct from old.document->'items' or ((new.document->'billing') - array['sellerName','sellerAddress','sellerTaxId','paymentInstructions','bankAccountId','bankAccount']) is distinct from ((old.document->'billing') - array['sellerName','sellerAddress','sellerTaxId','paymentInstructions','bankAccountId','bankAccount']) then
      raise exception 'Order items, customer, PO number, and currency are locked while linked invoices exist. Delete drafts or void unpaid invoices before changing them.';
    end if;
    if new.document->>'status' in ('draft','cancelled') then raise exception 'Delete draft invoices or void unpaid invoices before cancelling or reopening this order.'; end if;
  end if;
  if coalesce(new.document->>'paymentPolicy','full_before_shipment') not in ('full_before_shipment','custom') then raise exception 'Invalid payment policy.'; end if;
  required_percent := case when new.document->>'paymentPolicy'='custom' then (new.document->>'preShipmentPercent')::integer else 100 end;
  if required_percent is null or required_percent not between 0 and 100 then raise exception 'Enter a payment percentage between 0 and 100.'; end if;
  if new.document->>'paymentPolicy'='custom' and length(btrim(coalesce(new.document->>'paymentTerms',''))) = 0 then raise exception 'Describe the agreed payment terms for this exception.'; end if;
  if new.document->>'status' in ('shipped','completed') and
    (tg_op='INSERT' or old.document->>'status' not in ('shipped','completed')) and required_percent>0 then
    for ordered,idx in select value,ordinality from jsonb_array_elements(new.document->'items') with ordinality loop
      select coalesce(sum((x->>'quantity')::bigint),0) into quantity
      from public.invoices i cross join lateral jsonb_array_elements(i.document->'items') x
      where i.purchase_order_id=new.id and i.status='issued' and x->>'purchaseOrderLineId'='line-'||idx::text;
      if quantity < (ordered->>'quantity')::bigint then raise exception 'Invoice all order items and record the agreed payment before shipment.'; end if;
    end loop;
    select coalesce(sum(total_minor),0),coalesce(sum(paid_minor),0) into billed,paid from public.invoices where purchase_order_id=new.id and status='issued';
    if billed<=0 or paid < ceil(billed::numeric*required_percent/100) then raise exception 'Payment required before shipment: % percent of issued order invoices. Record payment or save explicitly agreed custom terms.',required_percent; end if;
  end if;
  return new;
end;
$$;



-- Remove the retired options from saved orders. Financial fields and selected
-- customer payment methods remain intact; issued document snapshots stay fixed.
update public.purchase_orders set document=jsonb_set(document,'{billing}',(document->'billing') - array['sellerName','sellerAddress','sellerTaxId','paymentInstructions','bankAccountId','bankAccount']),version=version+1
where document->'billing' ?| array['sellerName','sellerAddress','sellerTaxId','paymentInstructions','bankAccountId','bankAccount'];
-- Refresh drafts created before the PO had its own billing configuration too.
update public.purchase_orders po set version=version+1 where exists(select 1 from public.invoices i
  where i.purchase_order_id=po.id and i.workspace_id=po.workspace_id and i.order_managed and i.status='draft'
    and (i.document ?| array['bankAccountId','bankAccount'] or coalesce(i.document->>'paymentInstructions','')<>''));
notify pgrst,'reload schema';
commit;
