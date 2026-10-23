begin;
alter table public.invoices
  add column company_id uuid references public.companies(id) on delete set null,
  add column contact_id uuid references public.contacts(id) on delete set null,
  add column source_thread_id text;
create index invoices_company_number_idx on public.invoices(company_id, number desc);
create index invoices_contact_idx on public.invoices(contact_id);
create index invoices_thread_idx on public.invoices(source_thread_id) where source_thread_id is not null;

create table public.customer_billing_profiles (
  company_id uuid primary key references public.companies(id) on delete cascade,
  profile jsonb not null check(jsonb_typeof(profile)='object'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table public.invoice_settings (
  singleton boolean primary key default true check(singleton),
  settings jsonb not null check(jsonb_typeof(settings)='object'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index customer_billing_profiles_updated_by_idx on public.customer_billing_profiles(updated_by);
create index invoice_settings_updated_by_idx on public.invoice_settings(updated_by);
alter table public.customer_billing_profiles enable row level security;
alter table public.invoice_settings enable row level security;
revoke all on public.customer_billing_profiles, public.invoice_settings from anon, authenticated;
grant all on public.customer_billing_profiles, public.invoice_settings to service_role;

-- Existing snapshots can be linked only by an exact unique contact email.
-- Names and monetary content are preserved.
update public.invoices i set
  company_id=c.company_id, contact_id=c.id,
  document=i.document || jsonb_build_object('companyId',c.company_id,'contactId',c.id)
from public.contacts c where lower(btrim(i.document->>'customerEmail'))=lower(c.email::text)
  and i.company_id is null and not(i.document ? 'companyId');

create function public.link_invoice_document() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  new.company_id := nullif(new.document->>'companyId','')::uuid;
  new.contact_id := nullif(new.document->>'contactId','')::uuid;
  new.source_thread_id := nullif(new.document->>'sourceThreadId','');
  if new.contact_id is not null and (new.company_id is null or not exists(select 1 from public.contacts where id=new.contact_id and company_id=new.company_id)) then
    raise exception 'The selected contact does not belong to this customer.';
  end if;
  return new;
end; $$;
revoke all on function public.link_invoice_document() from public,anon,authenticated;
grant execute on function public.link_invoice_document() to service_role;
create trigger invoices_link_document before insert or update of document on public.invoices
for each row execute function public.link_invoice_document();

-- Financial activity appears on the customer's existing CRM timeline.
create function public.invoice_crm_activity() returns trigger
language plpgsql security invoker set search_path='' as $$
declare inv public.invoices;
begin
  select * into inv from public.invoices where id=new.invoice_id;
  if inv.company_id is not null and new.action in ('issue','payment','void') then
    insert into public.events(company_id,actor_id,type,data)
    values(inv.company_id,new.actor_id,'invoice_'||new.action,jsonb_build_object(
      'invoiceId',inv.id,'summary','INV-'||lpad(inv.number::text,6,'0')||' · '||new.action||' · '||
      btrim(inv.document->>'currency')||' '||to_char(inv.total_minor::numeric/100,'FM9999999999990.00')||
      ' total; '||to_char((inv.total_minor-inv.paid_minor)::numeric/100,'FM9999999999990.00')||' outstanding'));
  end if;
  return new;
end; $$;
revoke all on function public.invoice_crm_activity() from public,anon,authenticated;
grant execute on function public.invoice_crm_activity() to service_role;
create trigger invoice_events_crm_activity after insert on public.invoice_events
for each row execute function public.invoice_crm_activity();

create function public.invoice_receivables(p_company_id uuid default null, p_search text default '', p_status text default '')
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
    select document->>'currency' as currency,
      coalesce(sum(total_minor) filter(where status='issued'),0) as issued_minor,
      coalesce(sum(paid_minor) filter(where status='issued'),0) as paid_minor,
      coalesce(sum(total_minor-paid_minor) filter(where status='issued'),0) as outstanding_minor,
      coalesce(sum(total_minor-paid_minor) filter(where status='issued' and document->>'dueDate'<current_date::text),0) as overdue_minor
    from public.invoices
    where (p_company_id is null or company_id=p_company_id)
      and (p_search='' or document->>'customerName' ilike '%'||p_search||'%')
      and (p_status not in ('draft','issued','void') or status=p_status)
    group by document->>'currency' order by document->>'currency'
  ) t;
$$;
revoke all on function public.invoice_receivables(uuid,text,text) from public,anon,authenticated;
grant execute on function public.invoice_receivables(uuid,text,text) to service_role;
commit;
