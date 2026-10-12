alter table if exists public.emails
  add column if not exists sequence_id uuid,
  add column if not exists owner_id uuid references auth.users(id) on delete set null,
  add column if not exists step_number integer,
  add column if not exists rejection_reason text,
  add column if not exists approved_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists emails_owner_id_idx on public.emails(owner_id);
create index if not exists emails_sequence_id_idx on public.emails(sequence_id);
create index if not exists emails_updated_at_idx on public.emails(updated_at);

update public.emails
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;
