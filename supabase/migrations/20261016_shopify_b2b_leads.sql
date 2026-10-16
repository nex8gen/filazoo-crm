begin;

create table if not exists public.shopify_leads (
  webhook_id text primary key,
  shop_domain text not null,
  customer_id text not null,
  email citext not null,
  company_name text not null,
  full_name text,
  phone text,
  tags text[] not null default '{}',
  status text not null default 'processing' check (status in ('processing','processed','failed')),
  company_id uuid references public.companies(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  error_message text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists shopify_leads_customer_id_idx on public.shopify_leads(customer_id);
create index if not exists shopify_leads_email_created_at_idx on public.shopify_leads(email, created_at desc);
create index if not exists shopify_leads_status_created_at_idx on public.shopify_leads(status, created_at desc);
create index if not exists shopify_leads_company_id_idx on public.shopify_leads(company_id);
create index if not exists shopify_leads_contact_id_idx on public.shopify_leads(contact_id);

drop trigger if exists shopify_leads_set_updated_at on public.shopify_leads;
create trigger shopify_leads_set_updated_at before update on public.shopify_leads
for each row execute function public.set_updated_at();

alter table public.shopify_leads enable row level security;
revoke all on public.shopify_leads from anon, authenticated;
grant all on public.shopify_leads to service_role;

commit;
