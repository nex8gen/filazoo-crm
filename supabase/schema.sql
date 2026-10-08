-- Filazoo CRM production schema. Run once in the Supabase SQL Editor.
-- CRM tables are server-only. The publishable key is reserved for Auth.

begin;
create extension if not exists citext;

create or replace function public.set_updated_at() returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.workspace_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('admin','operator','viewer')),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(), name text not null, website text,
  domain citext unique, linkedin_url text, country text, city text, segment text,
  employee_count integer check (employee_count is null or employee_count >= 0),
  source text, source_url text,
  status text not null default 'new' check (status in ('new','researching','qualified','contacted','engaged','customer','disqualified')),
  discovered_at timestamptz not null default now(), last_verified_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text, role text, email citext not null unique, linkedin_url text,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','valid','risky','invalid','unknown')),
  verification_provider text, verified_at timestamptz,
  confidence numeric(5,2) check (confidence is null or confidence between 0 and 100),
  unsubscribed boolean not null default false, consent_source text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.company_profiles (
  company_id uuid primary key references public.companies(id) on delete cascade,
  summary text, products_they_print text, likely_materials text[] not null default array[]::text[],
  likely_products text[] not null default array[]::text[], company_size text,
  fit_score integer check (fit_score is null or fit_score between 0 and 100),
  interest_tags text[] not null default array[]::text[], evidence jsonb not null default '[]'::jsonb,
  model_name text, profiled_at timestamptz, updated_at timestamptz not null default now()
);

create table public.products (
  sku text primary key, name text not null, material text, color text, diameter text, weight text,
  price numeric(12,2) check (price is null or price >= 0), currency char(3) not null default 'USD',
  moq integer check (moq is null or moq >= 0), stock_status text, lead_time text,
  tags text[] not null default array[]::text[], description text, image_url text,
  active boolean not null default true, sheet_updated_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.product_sync_runs (
  id uuid primary key default gen_random_uuid(), status text not null check (status in ('running','succeeded','failed')),
  rows_seen integer not null default 0, rows_changed integer not null default 0,
  error_message text, started_at timestamptz not null default now(), finished_at timestamptz
);

create table public.catalogs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  product_skus text[] not null default array[]::text[], pdf_url text, currency char(3) not null default 'USD',
  price_date date not null default current_date, version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now()
);

create table public.emails (
  id uuid primary key default gen_random_uuid(), contact_id uuid not null references public.contacts(id) on delete cascade,
  catalog_id uuid references public.catalogs(id) on delete set null,
  direction text not null check (direction in ('sent','received')), subject text, body text,
  thread_id text, message_id text unique,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','scheduled','sent','received','failed','cancelled')),
  step integer not null default 1 check (step > 0), scheduled_for timestamptz,
  approved_by uuid references auth.users(id) on delete set null, approved_at timestamptz,
  sent_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.pipeline (
  company_id uuid primary key references public.companies(id) on delete cascade,
  stage text not null default 'new' check (stage in ('new','qualified','contacted','replied','sample','negotiation','won','lost')),
  notes text, estimated_value numeric(14,2) check (estimated_value is null or estimated_value >= 0),
  currency char(3) not null default 'USD', next_followup_at timestamptz,
  owner_id uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null, type text not null,
  data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create table public.suppression (
  email citext primary key, reason text not null, source text, created_at timestamptz not null default now()
);

create index companies_status_idx on public.companies(status);
create index companies_segment_country_idx on public.companies(segment,country);
create index contacts_company_id_idx on public.contacts(company_id);
create index contacts_verification_status_idx on public.contacts(verification_status);
create index emails_contact_id_idx on public.emails(contact_id);
create index emails_status_scheduled_for_idx on public.emails(status,scheduled_for);
create index events_company_created_at_idx on public.events(company_id,created_at desc);
create index pipeline_stage_idx on public.pipeline(stage);

create trigger workspace_members_set_updated_at before update on public.workspace_members for each row execute function public.set_updated_at();
create trigger companies_set_updated_at before update on public.companies for each row execute function public.set_updated_at();
create trigger contacts_set_updated_at before update on public.contacts for each row execute function public.set_updated_at();
create trigger company_profiles_set_updated_at before update on public.company_profiles for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger emails_set_updated_at before update on public.emails for each row execute function public.set_updated_at();
create trigger pipeline_set_updated_at before update on public.pipeline for each row execute function public.set_updated_at();

alter table public.workspace_members enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.company_profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_sync_runs enable row level security;
alter table public.catalogs enable row level security;
alter table public.emails enable row level security;
alter table public.pipeline enable row level security;
alter table public.events enable row level security;
alter table public.suppression enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

commit;
