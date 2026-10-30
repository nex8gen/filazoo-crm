-- Filename matches the version recorded by the connected Supabase migration service.
begin;

alter table public.catalogs
  add column quote_document jsonb,
  add column quote_status text not null default 'draft' check (quote_status in ('draft','shared','accepted','declined','cancelled','superseded')),
  add column quote_revision integer not null default 0 check (quote_revision >= 0),
  add column quote_order_id uuid references public.purchase_orders(id) on delete restrict,
  add column quote_previous_id uuid references public.catalogs(id) on delete set null,
  add constraint catalogs_quote_document_object check (quote_document is null or jsonb_typeof(quote_document) = 'object'),
  add constraint catalogs_quote_status_document check (quote_status = 'draft' or quote_document is not null);
create unique index catalogs_quote_order_idx on public.catalogs(quote_order_id) where quote_order_id is not null;
create index catalogs_quote_previous_idx on public.catalogs(quote_previous_id) where quote_previous_id is not null;
create index catalogs_quote_work_idx on public.catalogs(user_id,quote_status) where quote_document is not null;

-- The browser cannot call this RPC or access CRM tables. The authenticated
-- server resolves the actor, validates saved-price inputs, and supplies the order.
-- Row locks + revisions serialize edits, acceptance and order creation together.
create function public.mutate_catalog_quotation(
  p_id uuid, p_actor uuid, p_expected integer, p_action text,
  p_document jsonb default null, p_order jsonb default null,
  p_note text default null, p_snapshot jsonb default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  c public.catalogs; actor_role text; line jsonb; order_line jsonb;
  subtotal numeric := 0; freight numeric; new_id uuid; order_id uuid;
  business_day date := (now() at time zone 'Asia/Shanghai')::date;
  ref text; idx integer := 0; summary text;
begin
  select role into actor_role from public.workspace_members where user_id = p_actor and activated_at is not null;
  if actor_role is null or actor_role not in ('admin','operator','bd_manager') then raise exception 'Quotation changes require an active sales account.'; end if;
  select * into c from public.catalogs where id = p_id and user_id = p_actor for update;
  if not found then raise exception 'Quotation not found in your account.'; end if;
  if actor_role = 'bd_manager' and not exists(select 1 from public.pipeline where company_id = c.company_id and owner_id = p_actor) then
    raise exception 'This customer is no longer assigned to you.';
  end if;
  if p_action = 'convert' and c.quote_order_id is not null then
    return jsonb_build_object('id',c.id,'orderId',c.quote_order_id,'revision',c.quote_revision);
  end if;
  if p_expected is distinct from c.quote_revision then raise exception 'This quotation changed. Reload it before continuing.'; end if;
  ref := 'Q-' || upper(left(replace(c.id::text,'-',''),8)) || '-V' || c.version;

  if p_action = 'save' then
    if c.quote_status <> 'draft' or c.quote_order_id is not null then raise exception 'Create a new version to change a shared or accepted quotation.'; end if;
    if c.product_snapshot is null then raise exception 'Create a current version before preparing this older selection.'; end if;
    if jsonb_typeof(p_document) is distinct from 'object' or p_document->>'currency' is distinct from btrim(c.currency) or
      jsonb_typeof(p_document->'items') is distinct from 'array' or jsonb_array_length(p_document->'items') not between 1 and 99 then
      raise exception 'Choose 1 to 99 saved products in the quotation currency.';
    end if;
    for line in select value from jsonb_array_elements(p_document->'items') loop
      if not coalesce(line->>'productSku' = any(c.product_skus),false) or
        jsonb_typeof(line->'quantity') is distinct from 'number' or jsonb_typeof(line->'unitPriceMinor') is distinct from 'number' then
        raise exception 'Quotation items must use the saved product selection and numeric amounts.';
      end if;
      if (line->>'quantity')::numeric not between 1 and 1000000 or (line->>'quantity')::numeric <> trunc((line->>'quantity')::numeric) or
        (line->>'unitPriceMinor')::numeric not between 0 and 100000000 or (line->>'unitPriceMinor')::numeric <> trunc((line->>'unitPriceMinor')::numeric) then
        raise exception 'Enter supported whole quantities and prices.';
      end if;
      subtotal := subtotal + (line->>'quantity')::numeric * (line->>'unitPriceMinor')::numeric;
    end loop;
    if jsonb_typeof(p_document->'shippingMinor') is distinct from 'number' then raise exception 'Enter a valid shipping cost.'; end if;
    freight := (p_document->>'shippingMinor')::numeric;
    if freight < 0 or freight > 100000000 or freight <> trunc(freight) or subtotal + freight > 1000000000000 or
      (p_document->>'subtotalMinor')::numeric is distinct from subtotal or (p_document->>'totalMinor')::numeric is distinct from subtotal + freight then
      raise exception 'Quotation totals must equal the items and shipping cost.';
    end if;
    if (p_document->>'validUntil')::date < (p_document->>'issueDate')::date then raise exception 'Choose a valid quotation expiry date.'; end if;
    update public.catalogs set quote_document = p_document, quote_revision = quote_revision + 1 where id = c.id returning * into c;
    summary := ref || ' draft saved.';
  elsif p_action = 'share' then
    if c.quote_status <> 'draft' or c.quote_document is null then raise exception 'Save a draft quotation before recording it as shared.'; end if;
    if (c.quote_document->>'validUntil')::date < business_day then raise exception 'This quotation has expired. Create a new version.'; end if;
    if coalesce((c.quote_document->>'shippingConfirmed')::boolean,false) is not true or length(btrim(coalesce(c.quote_document->>'paymentTerms',''))) = 0 then
      raise exception 'Confirm shipping and payment terms before sharing.';
    end if;
    update public.catalogs set quote_status = 'shared', quote_revision = quote_revision + 1 where id = c.id returning * into c;
    summary := ref || ' recorded as shared by staff. This action did not send an email.';
  elsif p_action = 'accept' then
    if c.quote_status <> 'shared' or c.quote_document is null then raise exception 'Only a shared quotation can be recorded as accepted.'; end if;
    if (c.quote_document->>'validUntil')::date < business_day then raise exception 'This quotation has expired. Create a new version.'; end if;
    if length(btrim(coalesce(p_note,''))) not between 1 and 2000 then raise exception 'Record how the customer confirmed acceptance.'; end if;
    update public.catalogs set quote_status = 'accepted', quote_revision = quote_revision + 1 where id = c.id returning * into c;
    summary := ref || ' customer acceptance recorded by staff.';
  elsif p_action in ('decline','cancel') then
    if c.quote_status not in ('draft','shared') or (p_action = 'decline' and c.quote_status <> 'shared') then raise exception 'This quotation cannot be changed to that status.'; end if;
    update public.catalogs set quote_status = case when p_action = 'decline' then 'declined' else 'cancelled' end, quote_revision = quote_revision + 1 where id = c.id returning * into c;
    summary := ref || ' ' || c.quote_status || '.';
  elsif p_action = 'revise' then
    if c.product_snapshot is null and (jsonb_typeof(p_snapshot) is distinct from 'array' or jsonb_array_length(p_snapshot) <> cardinality(c.product_skus)) then
      raise exception 'Choose current products before creating a new version.';
    end if;
    insert into public.catalogs(user_id,company_id,product_skus,product_snapshot,currency,version,quote_document,quote_revision,quote_previous_id)
      values(p_actor,c.company_id,c.product_skus,coalesce(c.product_snapshot,p_snapshot),c.currency,1,
        case when c.quote_document is null then null else c.quote_document || jsonb_build_object('issueDate',business_day::text,'validUntil',(business_day+14)::text,'shippingConfirmed',false) end,
        case when c.quote_document is null then 0 else 1 end,c.id) returning id into new_id;
    update public.catalogs set quote_status = case when quote_status = 'shared' then 'superseded' else quote_status end,
      quote_revision = quote_revision + 1 where id = c.id returning * into c;
    summary := ref || ' copied to a new quotation version.';
  elsif p_action = 'convert' then
    if c.quote_status <> 'accepted' or c.quote_document is null then raise exception 'Record customer acceptance before creating an order.'; end if;
    if jsonb_typeof(p_order) is distinct from 'object' or jsonb_typeof(p_order->'items') is distinct from 'array' or
      p_order->>'currency' is distinct from btrim(c.currency) or p_order->>'reference' is distinct from ref then raise exception 'The order must match the accepted quotation.'; end if;
    freight := (c.quote_document->>'shippingMinor')::numeric;
    if jsonb_array_length(p_order->'items') <> jsonb_array_length(c.quote_document->'items') + (case when freight > 0 then 1 else 0 end) then
      raise exception 'Order quantities, prices and freight must match the accepted quotation.';
    end if;
    for line in select value from jsonb_array_elements(c.quote_document->'items') loop
      order_line := p_order->'items'->idx;
      if (order_line->>'quantity')::numeric is distinct from (line->>'quantity')::numeric or
        (order_line->>'unitPriceMinor')::numeric is distinct from (line->>'unitPriceMinor')::numeric or
        order_line->>'sku' is distinct from line->>'sku' or (order_line ? 'productSku' and order_line->>'productSku' is distinct from line->>'productSku') then
        raise exception 'Order quantities, prices and SKUs must match the accepted quotation.';
      end if;
      idx := idx + 1;
    end loop;
    if freight > 0 and ((p_order->'items'->idx->>'quantity')::numeric is distinct from 1 or (p_order->'items'->idx->>'unitPriceMinor')::numeric is distinct from freight or p_order->'items'->idx ? 'productSku') then
      raise exception 'Shipping must remain a separate order line.';
    end if;
    insert into public.purchase_orders(company_id,reference,document,total_minor,created_by,updated_by)
      values(c.company_id,ref,p_order || jsonb_build_object('status','draft'),(c.quote_document->>'totalMinor')::bigint,p_actor,p_actor) returning id into order_id;
    update public.catalogs set quote_order_id = order_id, quote_revision = quote_revision + 1 where id = c.id returning * into c;
    summary := ref || ' converted to a draft purchase order. No invoice was issued.';
  else raise exception 'Unsupported quotation action.';
  end if;
  insert into public.events(company_id,actor_id,type,data) values(c.company_id,p_actor,'catalog_quotation_' || p_action,
    jsonb_build_object('catalogId',c.id,'revision',c.quote_revision,'summary',summary,'acceptanceNote',case when p_action='accept' then p_note else null end,'newCatalogId',new_id,'purchaseOrderId',c.quote_order_id));
  return jsonb_build_object('id',c.id,'revision',c.quote_revision,'status',c.quote_status,'orderId',c.quote_order_id,'newId',new_id);
end;
$$;
revoke all on function public.mutate_catalog_quotation(uuid,uuid,integer,text,jsonb,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.mutate_catalog_quotation(uuid,uuid,integer,text,jsonb,jsonb,text,jsonb) to service_role;

commit;
