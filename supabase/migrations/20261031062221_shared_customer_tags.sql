begin;

-- Purchasing situation is shared; read/star/folder/reminder state stays personal.
create table public.crm_email_tags (
  message_key text primary key check (length(message_key) between 1 and 512),
  company_id uuid references public.companies(id) on delete cascade,
  contact_email text,
  tag text check (tag in (
    'Prospect Nurturing', 'New Inquiries', 'Quotation Follow-up', 'Active Negotiations',
    'Payment Follow-up', 'Orders in Fulfillment', 'Repeat Customers', 'Inactive Customers',
    'Long-term Inactive Customers', 'Postponed Purchasing'
  )),
  updated_at timestamptz not null default now()
);
create index crm_email_tags_company_idx on public.crm_email_tags(company_id);
create index crm_email_tags_contact_idx on public.crm_email_tags(contact_email);
alter table public.crm_email_tags enable row level security;
revoke all on public.crm_email_tags from anon, authenticated;
grant all on public.crm_email_tags to service_role;

-- A tag applied before a contact is created must also appear on the company later.
create function public.link_customer_email_tags() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.crm_email_tags set company_id = new.company_id
    where contact_email = lower(trim(new.email::text))
      and company_id is distinct from new.company_id;
  return new;
end;
$$;
revoke all on function public.link_customer_email_tags() from public, anon, authenticated;
grant execute on function public.link_customer_email_tags() to service_role;
create trigger contacts_link_customer_email_tags
  after insert or update of email, company_id on public.contacts
  for each row execute function public.link_customer_email_tags();

-- Legacy categories remain in email_inbox_state for existing automations/history.
-- They do not establish an order, quotation, or payment fact and are not guessed into tags.
notify pgrst, 'reload schema';
commit;
