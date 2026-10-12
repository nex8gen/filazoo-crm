begin;

create table if not exists public.meta_messages (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,
  thread_id text not null,
  page_id text not null,
  sender_id text not null,
  recipient_id text not null,
  customer_name text,
  direction text not null check (direction in ('inbound','outbound')),
  body text not null,
  message_type text not null default 'text',
  status text not null default 'received' check (status in ('received','sent','failed')),
  source text not null default 'facebook_messenger' check (source = 'facebook_messenger'),
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_leads (
  leadgen_id text primary key,
  page_id text not null,
  form_id text,
  ad_id text,
  adgroup_id text,
  full_name text,
  email text,
  phone text,
  field_data jsonb not null default '[]'::jsonb,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meta_messages_thread_created_at_idx on public.meta_messages(thread_id, created_at desc);
create index if not exists meta_messages_page_created_at_idx on public.meta_messages(page_id, created_at desc);
create index if not exists meta_messages_direction_status_idx on public.meta_messages(direction, status);
create index if not exists meta_leads_page_created_at_idx on public.meta_leads(page_id, created_at desc);
create index if not exists meta_leads_form_created_at_idx on public.meta_leads(form_id, created_at desc);

drop trigger if exists meta_messages_set_updated_at on public.meta_messages;
create trigger meta_messages_set_updated_at before update on public.meta_messages
for each row execute function public.set_updated_at();

drop trigger if exists meta_leads_set_updated_at on public.meta_leads;
create trigger meta_leads_set_updated_at before update on public.meta_leads
for each row execute function public.set_updated_at();

alter table public.meta_messages enable row level security;
alter table public.meta_leads enable row level security;

revoke all on public.meta_messages, public.meta_leads from anon, authenticated;
grant all on public.meta_messages, public.meta_leads to service_role;

commit;
