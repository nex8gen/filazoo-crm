begin;

-- Managers can edit their own drafts; billing transitions remain admin/operator only.
create or replace function public.mutate_invoice(p_id uuid, p_actor uuid, p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  inv public.invoices;
  prior public.invoice_payments;
  operation text := p_input->>'action';
  payment jsonb := p_input->'payment';
  amount bigint;
  actor_role text;
begin
  select role into actor_role from public.workspace_members where user_id = p_actor and activated_at is not null;
  if actor_role is null or actor_role not in ('admin','operator','bd_manager') then
    raise exception 'Billing access denied.';
  end if;
  select * into inv from public.invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found.'; end if;
  if actor_role = 'bd_manager' and (operation is distinct from 'save' or inv.created_by is distinct from p_actor or inv.status <> 'draft') then
    raise exception 'BD managers can only edit draft invoices they created.';
  end if;
  if operation = 'payment' then
    select * into prior from public.invoice_payments where id = (payment->>'id')::uuid;
    if found then
      if prior.invoice_id <> p_id or prior.amount_minor <> (payment->>'amountMinor')::bigint
         or prior.paid_on <> (payment->>'paidOn')::date or prior.method <> payment->>'method'
         or prior.reference <> payment->>'reference' then
        raise exception 'Payment reference was already used for a different payment.';
      end if;
      return to_jsonb(inv);
    end if;
    if inv.status <> 'issued' then raise exception 'Only issued invoices can receive payments.'; end if;
    amount := (payment->>'amountMinor')::bigint;
    if amount is null or amount <= 0 or amount > inv.total_minor - inv.paid_minor then raise exception 'Payment exceeds the outstanding balance or is invalid.'; end if;
    if (payment->>'paidOn')::date > current_date then raise exception 'Payment date cannot be in the future.'; end if;
    insert into public.invoice_payments(id, invoice_id, amount_minor, paid_on, method, reference, created_by)
    values ((payment->>'id')::uuid, p_id, amount, (payment->>'paidOn')::date, payment->>'method', payment->>'reference', p_actor);
    update public.invoices set paid_minor = paid_minor + amount, revision = revision + 1, updated_at = now() where id = p_id returning * into inv;
  else
    if inv.revision <> (p_input->>'revision')::integer then raise exception 'This invoice changed. Reload it before continuing.'; end if;
    if operation = 'save' then
      if inv.status <> 'draft' then raise exception 'Only drafts can be edited.'; end if;
      update public.invoices set document = p_input->'document', total_minor = (p_input->>'totalMinor')::bigint,
        revision = revision + 1, updated_at = now() where id = p_id returning * into inv;
    elsif operation = 'issue' then
      if inv.status <> 'draft' or inv.total_minor <= 0 then raise exception 'Only a draft with a positive total can be issued.'; end if;
      update public.invoices set status = 'issued', revision = revision + 1, updated_at = now() where id = p_id returning * into inv;
    elsif operation = 'void' then
      if inv.status <> 'issued' or inv.paid_minor <> 0 then raise exception 'Only an unpaid issued invoice can be voided.'; end if;
      update public.invoices set status = 'void', revision = revision + 1, updated_at = now() where id = p_id returning * into inv;
    elsif operation = 'delete' then
      if inv.status <> 'draft' then raise exception 'Only drafts can be deleted.'; end if;
      delete from public.invoices where id = p_id;
      return null;
    else
      raise exception 'Unknown invoice action.';
    end if;
  end if;
  insert into public.invoice_events(invoice_id, actor_id, action) values(p_id, p_actor, operation);
  return to_jsonb(inv);
end;
$$;
revoke all on function public.mutate_invoice(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.mutate_invoice(uuid,uuid,jsonb) to service_role;

commit;
