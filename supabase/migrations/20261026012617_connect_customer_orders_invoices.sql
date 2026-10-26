begin;
alter table public.invoices add column purchase_order_id uuid references public.purchase_orders(id) on delete restrict;
create index invoices_purchase_order_idx on public.invoices(purchase_order_id);

-- Serialize allocations for the same order, including concurrent draft creation.
create function public.guard_order_invoice() returns trigger
language plpgsql security invoker set search_path='' as $$
declare po public.purchase_orders; line jsonb; ordered jsonb; idx integer; used bigint;
begin
  if tg_op='UPDATE' and old.purchase_order_id is not null and
    nullif(new.document->>'purchaseOrderId','')::uuid is distinct from old.purchase_order_id then
    raise exception 'A linked invoice cannot be moved to another order. Delete the draft or void the invoice first.';
  end if;
  new.purchase_order_id := nullif(new.document->>'purchaseOrderId','')::uuid;
  if new.purchase_order_id is null then
    if exists(select 1 from jsonb_array_elements(coalesce(new.document->'items','[]')) x where x ? 'purchaseOrderLineId') then raise exception 'Order lines require a linked order.'; end if;
    return new;
  end if;
  select * into po from public.purchase_orders where id=new.purchase_order_id for update;
  if not found then raise exception 'Customer order not found.'; end if;
  if po.company_id is distinct from nullif(new.document->>'companyId','')::uuid
    or po.document->>'currency' is distinct from new.document->>'currency' then
    raise exception 'Invoice customer and currency must match the order.';
  end if;
  if new.status='void' then return new; end if;
  if po.document->>'status' in ('draft','cancelled') then raise exception 'Confirm the customer order before invoicing it.'; end if;
  if new.document->>'reference' is distinct from po.reference then raise exception 'Keep the customer PO reference on the linked invoice.'; end if;
  for line in select * from jsonb_array_elements(new.document->'items') loop
    if coalesce(line->>'purchaseOrderLineId','') !~ '^line-[1-9][0-9]*$' then raise exception 'Every invoice item must reference an order line. Use the shipping charge field for freight.'; end if;
    idx := substring(line->>'purchaseOrderLineId' from 6)::integer - 1;
    ordered := po.document->'items'->idx;
    if ordered is null or (line->>'quantity')::numeric <> trunc((line->>'quantity')::numeric)
      or (line->>'quantity')::numeric < 1
      or (line->>'unitPriceMinor')::bigint is distinct from (ordered->>'unitPriceMinor')::bigint
      or line->>'description' is distinct from ordered->>'description' then
      raise exception 'Invoice items and agreed unit prices must match the customer order.';
    end if;
    select coalesce(sum((x->>'quantity')::bigint),0) into used
    from public.invoices i cross join lateral jsonb_array_elements(i.document->'items') x
    where i.purchase_order_id=po.id and i.id<>new.id and i.status<>'void'
      and x->>'purchaseOrderLineId'=line->>'purchaseOrderLineId';
    select used+coalesce(sum((x->>'quantity')::bigint),0) into used
    from jsonb_array_elements(new.document->'items') x where x->>'purchaseOrderLineId'=line->>'purchaseOrderLineId';
    if used > (ordered->>'quantity')::bigint then raise exception 'This quantity is already invoiced or reserved in another draft. Open the existing invoice or reduce the quantity.'; end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_order_invoice() from public,anon,authenticated;
grant execute on function public.guard_order_invoice() to service_role;
create trigger invoices_order_guard before insert or update on public.invoices for each row execute function public.guard_order_invoice();

create function public.guard_order_fulfillment() returns trigger
language plpgsql security invoker set search_path='' as $$
declare required_percent integer; billed bigint; paid bigint; ordered jsonb; idx bigint; quantity bigint;
begin
  if tg_op='UPDATE' and exists(select 1 from public.invoices where purchase_order_id=old.id and status<>'void') then
    if new.company_id<>old.company_id or new.reference<>old.reference or new.document->'currency' is distinct from old.document->'currency'
      or new.document->'items' is distinct from old.document->'items' then
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
revoke all on function public.guard_order_fulfillment() from public,anon,authenticated;
grant execute on function public.guard_order_fulfillment() to service_role;
create trigger purchase_orders_fulfillment_guard before insert or update on public.purchase_orders for each row execute function public.guard_order_fulfillment();

commit;
