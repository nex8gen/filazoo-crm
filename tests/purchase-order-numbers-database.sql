begin;
do $$
declare
  company uuid; tenant uuid; first_order public.purchase_orders; second_order public.purchase_orders;
  external_reference text := 'SERIAL-EXTERNAL-'||gen_random_uuid()::text;
  blocked boolean := false;
  sample jsonb := '{"reference":"","orderDate":"2026-11-06","deliveryDate":"","currency":"USD","status":"draft","paymentPolicy":"full_before_shipment","preShipmentPercent":100,"paymentTerms":"","shippingAddress":"","shippingRecipient":"","shippingPhone":"","notes":"SERIAL ROLLBACK TEST","items":[{"description":"Serial verification","sku":"TEST","quantity":1,"unitPriceMinor":100}]}';
begin
  select company_id,workspace_id into company,tenant from public.purchase_orders order by created_at limit 1;
  if company is null then raise exception 'A company with an existing purchase order is needed for this rollback-only test.'; end if;
  perform set_config('crm.workspace_id',tenant::text,true);
  set local role crm_workspace_server;
  insert into public.purchase_orders(company_id,workspace_id,reference,document,total_minor)
    values(company,tenant,'',sample,100) returning * into first_order;
  insert into public.purchase_orders(company_id,workspace_id,reference,document,total_minor)
    values(company,tenant,external_reference,jsonb_set(sample,'{reference}',to_jsonb(external_reference)),100)
    returning * into second_order;
  if first_order.reference <> '#'||first_order.number::text or first_order.document->>'reference' <> first_order.reference then
    raise exception 'Blank references must use the generated order number in both places.';
  end if;
  if second_order.number <= first_order.number or second_order.reference <> external_reference then
    raise exception 'Numbers must increase while preserving external customer references.';
  end if;
  update public.purchase_orders set document=jsonb_set(document,'{notes}','"Changed notes"') where id=first_order.id;
  if (select number from public.purchase_orders where id=first_order.id) <> first_order.number then
    raise exception 'An ordinary edit changed the order number.';
  end if;
  begin
    update public.purchase_orders set number=default where id=first_order.id;
  exception when raise_exception then
    if sqlerrm <> 'The automatic order number cannot be changed.' then raise; end if;
    blocked := true;
  end;
  if not blocked then raise exception 'Number updates must be blocked.'; end if;
  begin
    insert into public.purchase_orders(company_id,workspace_id,number,reference,document,total_minor)
      values(company,tenant,999,'',sample,100);
    raise exception 'Explicit numbers must not be accepted.';
  exception when sqlstate '428C9' then null;
  end;
  if not has_sequence_privilege('crm_workspace_server','public.purchase_orders_number_seq','usage') then
    raise exception 'The scoped server role needs sequence usage.';
  end if;
end $$;
reset role;
select 'Automatic PO numbering, references, immutable edits and scoped permissions passed.' as result;
rollback;
