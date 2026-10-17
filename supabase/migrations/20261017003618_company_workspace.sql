begin;

alter table public.pipeline
  add column if not exists estimated_order_quantity integer
  check (estimated_order_quantity is null or estimated_order_quantity >= 0);

commit;
