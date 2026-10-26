begin;

-- Customer credentials and sessions are separate from auth.users/workspace_members.
-- Only the server service role can access these tables; portal routes enforce
-- invoice ownership on every operation. No customer receives a Supabase JWT.
create table public.customer_portal_accounts (
  email text primary key check (email = lower(btrim(email)) and length(email) between 3 and 320),
  password_hash text,
  credential_version integer not null default 0 check (credential_version >= 0),
  created_at timestamptz not null default now()
);
create table public.customer_portal_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  email text not null references public.customer_portal_accounts(email) on delete cascade,
  kind text not null check (kind in ('qr','member')),
  credential_version integer not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index customer_portal_sessions_invoice_idx on public.customer_portal_sessions(invoice_id);
create index customer_portal_sessions_email_idx on public.customer_portal_sessions(email);
create index customer_portal_sessions_expiry_idx on public.customer_portal_sessions(expires_at);
create table public.customer_portal_messages (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  sender text not null check (sender in ('customer','staff')),
  staff_id uuid references auth.users(id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  check (sender = 'staff' or staff_id is null)
);
create index customer_portal_messages_invoice_time_idx on public.customer_portal_messages(invoice_id, created_at desc, id desc);
create index customer_portal_messages_staff_idx on public.customer_portal_messages(staff_id);
create table public.customer_portal_shipments (
  invoice_id uuid primary key references public.invoices(id) on delete cascade,
  status text not null check (status in ('preparing','in_transit','out_for_delivery','delivered','exception')),
  location text not null default '' check (length(location) <= 200),
  carrier text not null default '' check (length(carrier) <= 100),
  tracking_number text not null default '' check (length(tracking_number) <= 200),
  tracking_url text not null default '' check (tracking_url = '' or tracking_url ~ '^https://'),
  expected_delivery text not null default '' check (expected_delivery = '' or expected_delivery ~ '^\d{4}-\d{2}-\d{2}$'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index customer_portal_shipments_updated_by_idx on public.customer_portal_shipments(updated_by);
create table public.customer_portal_rate_limits (
  key text primary key,
  attempts integer not null default 1,
  resets_at timestamptz not null
);
alter table public.customer_portal_accounts enable row level security;
alter table public.customer_portal_sessions enable row level security;
alter table public.customer_portal_messages enable row level security;
alter table public.customer_portal_shipments enable row level security;
alter table public.customer_portal_rate_limits enable row level security;
revoke all on public.customer_portal_accounts, public.customer_portal_sessions, public.customer_portal_messages, public.customer_portal_shipments, public.customer_portal_rate_limits from public, anon, authenticated;
grant all on public.customer_portal_accounts, public.customer_portal_sessions, public.customer_portal_messages, public.customer_portal_shipments, public.customer_portal_rate_limits to service_role;

-- Atomic, persistent throttling across application instances. Expired sessions
-- and rate buckets are pruned opportunistically, without a separate cron job.
create function public.customer_portal_rate_limit(p_key text, p_max integer) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare hits integer;
begin
  if length(p_key) <> 64 or p_max < 1 or p_max > 100 then return false; end if;
  delete from public.customer_portal_sessions where expires_at < now();
  delete from public.customer_portal_rate_limits where resets_at < now();
  insert into public.customer_portal_rate_limits as bucket(key,attempts,resets_at)
    values(p_key,1,now()+interval '15 minutes')
    on conflict(key) do update set attempts = bucket.attempts + 1
    returning attempts into hits;
  return hits <= p_max;
end;
$$;
revoke all on function public.customer_portal_rate_limit(text,integer) from public,anon,authenticated;
grant execute on function public.customer_portal_rate_limit(text,integer) to service_role;

commit;
