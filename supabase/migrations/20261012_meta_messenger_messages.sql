create table if not exists public.meta_messages (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,
  thread_id text not null,
  phone text not null,
  customer_name text,
  company_name text,
  direction text not null check (direction in ('inbound','outbound')),
  body text not null,
  status text not null default 'received' check (status in ('received','sent','failed')),
  source text not null default 'meta_whatsapp',
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meta_messages_thread_created_at_idx on public.meta_messages(thread_id, created_at desc);
create index if not exists meta_messages_phone_idx on public.meta_messages(phone);
create index if not exists meta_messages_direction_status_idx on public.meta_messages(direction, status);

create trigger if not exists meta_messages_set_updated_at
before update on public.meta_messages
for each row
execute function public.set_updated_at();

alter table public.meta_messages enable row level security;

create policy if not exists meta_messages_service_role_all_access on public.meta_messages
for all to service_role
using (true)
with check (true);
