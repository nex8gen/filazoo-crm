begin;

-- Identity allocation is atomic across concurrent creates, including quotation
-- conversions and company-profile entry points. Existing customer references stay intact.
alter table public.purchase_orders
  add column number bigint generated always as identity (start with 1001);
create unique index purchase_orders_number_idx on public.purchase_orders(number);
grant usage, select on sequence public.purchase_orders_number_seq to service_role, crm_workspace_server;

create function public.guard_purchase_order_number() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.number is distinct from old.number then
    raise exception 'The automatic order number cannot be changed.';
  end if;
  if tg_op = 'INSERT' and length(btrim(coalesce(new.reference, ''))) = 0 then
    new.reference := '#' || new.number::text;
    new.document := jsonb_set(new.document, '{reference}', to_jsonb(new.reference));
  end if;
  return new;
end;
$$;
revoke all on function public.guard_purchase_order_number() from public, anon, authenticated;
grant execute on function public.guard_purchase_order_number() to service_role, crm_workspace_server;
create trigger purchase_orders_00_number before insert or update on public.purchase_orders
  for each row execute function public.guard_purchase_order_number();

notify pgrst, 'reload schema';
commit;
