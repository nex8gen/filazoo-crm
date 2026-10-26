begin;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  reference text not null check (length(btrim(reference)) between 1 and 100),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  total_minor bigint not null check (total_minor between 0 and 1000000000000),
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (document->>'reference' is not null and document->>'reference' = reference),
  check (document->>'status' is not null and document->>'status' in ('draft','confirmed','in_production','shipped','completed','cancelled')),
  check (document->>'currency' is not null and document->>'currency' in ('USD','EUR','GBP','CNY')),
  check (jsonb_typeof(document->'items') = 'array' and jsonb_array_length(document->'items') between 1 and 100)
);
create unique index purchase_orders_company_reference_idx on public.purchase_orders(company_id, lower(btrim(reference)));
create index purchase_orders_company_created_idx on public.purchase_orders(company_id, created_at desc, id);
create index purchase_orders_created_by_idx on public.purchase_orders(created_by);
create index purchase_orders_updated_by_idx on public.purchase_orders(updated_by);

-- Access follows the CRM's existing server-side workspace authorization model.
alter table public.purchase_orders enable row level security;
revoke all on public.purchase_orders from public, anon, authenticated;
grant all on public.purchase_orders to service_role;

create function public.purchase_order_crm_activity() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.events(company_id,actor_id,type,data)
  values (new.company_id,new.updated_by,'purchase_order_' || case when tg_op = 'INSERT' then 'created' else 'updated' end,
    jsonb_build_object('purchaseOrderId',new.id,'summary','PO ' || new.reference || ' · ' || replace(new.document->>'status','_',' ') || ' · ' || (new.document->>'currency') || ' ' || to_char(new.total_minor::numeric / 100,'FM9999999999990.00')));
  return new;
end;
$$;
revoke all on function public.purchase_order_crm_activity() from public, anon, authenticated;
grant execute on function public.purchase_order_crm_activity() to service_role;
create trigger purchase_orders_crm_activity after insert or update on public.purchase_orders
for each row execute function public.purchase_order_crm_activity();

commit;
