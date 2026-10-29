begin;

-- Preserve historical snapshots, but validate new/changed product links on every write path.
create or replace function public.guard_purchase_order_products() returns trigger
language plpgsql security invoker set search_path='' as $$
declare line jsonb; idx bigint; product public.products; amount numeric := 0;
begin
  for line,idx in select value,ordinality from jsonb_array_elements(new.document->'items') with ordinality loop
    if jsonb_typeof(line) is distinct from 'object'
      or jsonb_typeof(line->'quantity') is distinct from 'number'
      or jsonb_typeof(line->'unitPriceMinor') is distinct from 'number' then
      raise exception 'Order items need a numeric quantity and unit price.';
    end if;
    if (line->>'quantity')::numeric <> trunc((line->>'quantity')::numeric)
      or (line->>'quantity')::numeric not between 1 and 1000000
      or (line->>'unitPriceMinor')::numeric <> trunc((line->>'unitPriceMinor')::numeric)
      or (line->>'unitPriceMinor')::numeric not between 0 and 100000000 then
      raise exception 'Order quantities and prices must be whole units within the supported limits.';
    end if;
    amount := amount + (line->>'quantity')::numeric * (line->>'unitPriceMinor')::numeric;
    if nullif(line->>'productSku','') is null then
      if line ? 'productSku' or line ? 'variantId' or line ? 'variantSku' or line->>'pricingMode'='catalog' then
        raise exception 'Select a catalog product before selecting its variant or catalog pricing.';
      end if;
      continue;
    end if;
    if tg_op='UPDATE' and new.document->>'currency'=old.document->>'currency'
      and line=old.document->'items'->(idx::integer-1) then
      continue;
    end if;
    if coalesce(line->>'pricingMode','') not in ('catalog','manual') then
      raise exception 'Choose catalog pricing or an agreed manual price for each linked product.';
    end if;
    select * into product from public.products where sku=line->>'productSku' and active;
    if not found then raise exception 'Product % is unavailable. Choose an active product or use a custom item.',line->>'productSku'; end if;
    if btrim(product.currency) is distinct from new.document->>'currency' then
      raise exception 'Product currency must match the purchase order currency.';
    end if;
    if nullif(line->>'variantId','') is null and line->>'sku' is distinct from product.sku then
      raise exception 'The SKU must match the selected product.';
    end if;
    if nullif(line->>'variantId','') is not null and
      (nullif(line->>'variantSku','') is null or line->>'sku' is distinct from line->>'variantSku') then
      raise exception 'The SKU must match the selected variant.';
    end if;
    if line->>'pricingMode'='catalog' and (line->>'quantity')::numeric < greatest(1,coalesce(product.moq,1)) then
      raise exception 'The product minimum quantity is %. Use an agreed manual price for an exception.',greatest(1,coalesce(product.moq,1));
    end if;
  end loop;
  if amount is distinct from new.total_minor::numeric or amount > 1000000000000 then
    raise exception 'Purchase order total must equal its line amounts.';
  end if;
  if tg_op='UPDATE' and old.document ? 'customer' and new.document->'customer' is distinct from old.document->'customer'
    and exists(select 1 from public.invoices where purchase_order_id=old.id and status<>'void') then
    raise exception 'Customer details are locked while linked invoices exist.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_purchase_order_products() from public,anon,authenticated;
grant execute on function public.guard_purchase_order_products() to service_role;
create trigger purchase_orders_product_guard before insert or update on public.purchase_orders
for each row execute function public.guard_purchase_order_products();

-- The invoice must retain the PO product snapshot, including its variant and agreed price.
create or replace function public.guard_order_invoice_products() returns trigger
language plpgsql security invoker set search_path='' as $$
declare po public.purchase_orders; line jsonb; source jsonb; idx integer; po_id uuid;
begin
  po_id := nullif(new.document->>'purchaseOrderId','')::uuid;
  if po_id is null or new.status='void' then return new; end if;
  select * into po from public.purchase_orders where id=po_id for update;
  if not found then raise exception 'Customer order not found.'; end if;
  for line in select * from jsonb_array_elements(new.document->'items') loop
    if coalesce(line->>'purchaseOrderLineId','') !~ '^line-[1-9][0-9]*$' then
      raise exception 'Every invoice item must reference an order line.';
    end if;
    idx := substring(line->>'purchaseOrderLineId' from 6)::integer - 1;
    source := po.document->'items'->idx;
    if source is null or line->>'productSku' is distinct from source->>'productSku'
      or line->>'variantId' is distinct from source->>'variantId'
      or line->>'variantSku' is distinct from source->>'variantSku'
      or line->>'imageUrl' is distinct from source->>'imageUrl'
      or (source ? 'productSku' and line->>'pricingMode' is distinct from 'manual') then
      raise exception 'Invoice product, variant, image and agreed pricing must match the purchase order.';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_order_invoice_products() from public,anon,authenticated;
grant execute on function public.guard_order_invoice_products() to service_role;
create trigger invoices_order_product_guard before insert or update on public.invoices
for each row execute function public.guard_order_invoice_products();

commit;
