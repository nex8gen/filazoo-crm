begin;
set local lock_timeout='5s';

-- Linked invoices use the order's number. Preserve existing standalone document
-- numbers, which may already have been sent, as historical billing records.
alter table public.invoices alter column number drop identity;
alter table public.invoices drop constraint invoices_number_key;
create unique index invoices_legacy_number_idx on public.invoices(workspace_id,number) where purchase_order_id is null;

create function public.shared_order_invoice_number() returns trigger
language plpgsql security invoker set search_path='' as $$
declare po_id uuid; shared_number bigint;
begin
  po_id:=nullif(new.document->>'purchaseOrderId','')::uuid;
  if po_id is not null then
    select number into shared_number from public.purchase_orders where id=po_id and workspace_id=new.workspace_id;
    if shared_number is null then raise exception 'Purchase order not found.'; end if;
    new.number:=shared_number;
  elsif tg_op='INSERT' then
    raise exception 'Create a purchase order first. Its invoice is generated automatically.';
  elsif new.number is distinct from old.number then
    raise exception 'The document number cannot be changed.';
  end if;
  return new;
end $$;
revoke all on function public.shared_order_invoice_number() from public,anon,authenticated;
grant execute on function public.shared_order_invoice_number() to service_role,crm_workspace_server;
create trigger invoices_00_shared_order_number before insert or update on public.invoices
  for each row execute function public.shared_order_invoice_number();

update public.invoices i set number=p.number from public.purchase_orders p
  where i.purchase_order_id=p.id and i.workspace_id=p.workspace_id and i.number<>p.number;

-- Voiding an unpaid document leaves an editable replacement on the same order,
-- with the same number. The original voided document stays in its history.
create function public.restore_order_invoice_draft() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.status='issued' and new.status='void' and new.order_managed then
    update public.purchase_orders set version=version+1,updated_at=now()
      where id=new.purchase_order_id and workspace_id=new.workspace_id and document->>'status'<>'cancelled';
  end if;
  return new;
end $$;
revoke all on function public.restore_order_invoice_draft() from public,anon,authenticated;
grant execute on function public.restore_order_invoice_draft() to service_role,crm_workspace_server;
create trigger invoices_restore_order_draft after update of status on public.invoices
  for each row execute function public.restore_order_invoice_draft();

-- Existing orders receive their draft too; no Create invoice step is needed.
do $$ declare p record; begin
  for p in select id,workspace_id from public.purchase_orders po where po.document->>'status'<>'cancelled'
    and not exists(select 1 from public.invoices i where i.purchase_order_id=po.id and i.workspace_id=po.workspace_id and i.status<>'void') loop
    perform set_config('crm.workspace_id',p.workspace_id::text,true);
    set local role crm_workspace_server;
    update public.purchase_orders set version=version+1 where id=p.id;
    reset role;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
