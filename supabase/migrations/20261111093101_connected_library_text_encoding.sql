begin;
-- Keep generated labels portable across CLI encodings.
create or replace function crm_tenancy.sync_library_source(source text, row_data jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare
  ws uuid := (row_data->>'workspace_id')::uuid; sid uuid := (row_data->>'id')::uuid;
  actor uuid; customer uuid; order_id uuid; inv_id uuid; title text; category_id text;
  customer_name text := ''; state text := ''; notes text := ''; mime text := 'application/pdf'; skus text[] := '{}';
  doc jsonb := coalesce(row_data->'document','{}'); inv public.invoices;
begin
  actor := coalesce(nullif(row_data->>'user_id','')::uuid,nullif(row_data->>'created_by','')::uuid);
  if actor is null then select owner_id into actor from public.workspaces where id=ws; end if;
  customer := nullif(row_data->>'company_id','')::uuid;
  state := coalesce(row_data->>'status',doc->>'status','');
  if source='quotation' then
    -- Catalog PDFs are private to their saved owner.
    if nullif(row_data->>'user_id','') is null then return; end if;
    category_id := 'quotation'; state := coalesce(row_data->>'quote_status','draft');
    title := 'Q-'||upper(left(replace(sid::text,'-',''),8))||'-V'||(row_data->>'version')||'.pdf';
    skus := array(select jsonb_array_elements_text(coalesce(row_data->'product_skus','[]')));
    order_id := nullif(row_data->>'quote_order_id','')::uuid;
    notes := case when row_data->'quote_document' is null or row_data->'quote_document'='null'::jsonb then 'Saved product selection. Open quotation to prepare quantities and terms.' else 'Saved CRM quotation. Open quotation to edit its products and terms.' end;
  elsif source='invoice' then
    category_id := case when state='draft' then 'proforma' else 'invoice' end;
    inv_id := sid; order_id := nullif(row_data->>'purchase_order_id','')::uuid;
    title := case when state='draft' then 'Draft invoice #' else 'Invoice #' end||(row_data->>'number')||'.pdf';
    notes := 'Automatically linked to its purchase order. Products and quantities follow the source record.';
  elsif source='purchase_order' then
    category_id := 'purchase_order'; order_id := sid;
    title := 'Purchase order #'||(row_data->>'number');
    mime := 'application/x-filazoo-record'; notes := 'Saved purchase order. Open the source order to review products, invoice and payments.';
  elsif source='payment' then
    select * into inv from public.invoices where workspace_id=ws and id=(row_data->>'invoice_id')::uuid;
    if not found then return; end if;
    customer := inv.company_id; order_id := inv.purchase_order_id; inv_id := inv.id; doc := inv.document;
    category_id := 'payment'; state := 'recorded'; title := 'Payment - Invoice #'||inv.number||' - '||(row_data->>'paid_on');
    mime := 'application/x-filazoo-record';
    notes := 'Payment recorded: '||to_char((row_data->>'amount_minor')::numeric/100,'FM999999999990.00')||' '||coalesce(doc->>'currency','')||' - '||coalesce(row_data->>'method','')||' - Reference: '||coalesce(row_data->>'reference','');
  else raise exception 'Unknown library source'; end if;
  if source<>'quotation' then
    skus := array(select distinct x->>'productSku' from jsonb_array_elements(coalesce(doc->'items','[]')) x where nullif(x->>'productSku','') is not null limit 100);
  end if;
  select left(name,160) into customer_name from public.companies where workspace_id=ws and id=customer;
  customer_name := coalesce(customer_name,left(doc->>'customerName',160),'');
  skus := skus[1:100];
  insert into public.library_documents(workspace_id,kind,name,mime_type,size,category,company,description,created_by,created_at,updated_at,source_type,source_id,source_status,company_id,purchase_order_id,invoice_id,product_skus,search_text)
  values(ws,'file',left(title,200),mime,0,category_id,customer_name,left(notes,2000),actor,(row_data->>'created_at')::timestamptz,coalesce((row_data->>'_library_updated_at')::timestamptz,(row_data->>'updated_at')::timestamptz,(row_data->>'created_at')::timestamptz),source,sid,state,customer,order_id,inv_id,skus,lower(title||' '||customer_name||' '||notes||' '||array_to_string(skus,' ')))
  on conflict(workspace_id,source_type,source_id) do update set
    name=excluded.name,mime_type=excluded.mime_type,category=excluded.category,company=excluded.company,description=excluded.description,updated_at=excluded.updated_at,
    source_status=excluded.source_status,company_id=excluded.company_id,purchase_order_id=excluded.purchase_order_id,invoice_id=excluded.invoice_id,product_skus=excluded.product_skus,search_text=excluded.search_text;
end;
$$;
do $$ declare r record; begin for r in select to_jsonb(t) as data from public.invoice_payments t loop perform crm_tenancy.sync_library_source('payment',r.data); end loop; end $$;
commit;
