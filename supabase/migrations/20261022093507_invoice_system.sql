begin;

-- Billing is a server-only API. Neither anonymous nor authenticated Data API
-- clients can bypass the workspace authorization in the invoice routes.
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  status text not null default 'draft' check (status in ('draft','issued','void')),
  total_minor bigint not null check (total_minor between 0 and 200000000000),
  paid_minor bigint not null default 0 check (paid_minor >= 0 and paid_minor <= total_minor),
  revision integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_status_number_idx on public.invoices(status, number desc);
create index invoices_created_by_idx on public.invoices(created_by);

create table public.invoice_payments (
  id uuid primary key,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  paid_on date not null,
  method text not null check (method in ('bank_transfer','cash','card','other')),
  reference text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index invoice_payments_invoice_idx on public.invoice_payments(invoice_id);
create index invoice_payments_created_by_idx on public.invoice_payments(created_by);

create table public.invoice_events (
  id bigint generated always as identity primary key,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  created_at timestamptz not null default now()
);
create index invoice_events_invoice_idx on public.invoice_events(invoice_id);
create index invoice_events_actor_idx on public.invoice_events(actor_id);

alter table public.invoices enable row level security;
alter table public.invoice_payments enable row level security;
alter table public.invoice_events enable row level security;
revoke all on public.invoices, public.invoice_payments, public.invoice_events from anon, authenticated;
grant all on public.invoices, public.invoice_payments, public.invoice_events to service_role;
grant usage, select on sequence public.invoices_number_seq, public.invoice_events_id_seq to service_role;

-- A single transaction and row lock protect state transitions and payment
-- balances. Revision checks prevent two open editors from overwriting a draft.
create function public.mutate_invoice(p_id uuid, p_actor uuid, p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  inv public.invoices;
  prior public.invoice_payments;
  operation text := p_input->>'action';
  payment jsonb := p_input->'payment';
  amount bigint;
begin
  if not exists(select 1 from public.workspace_members where user_id = p_actor and activated_at is not null and role in ('admin','operator')) then
    raise exception 'Billing access denied.';
  end if;
  select * into inv from public.invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found.'; end if;
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
