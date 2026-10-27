begin;
create table public.flow_email_test_runs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  recipient text not null,
  input jsonb not null,
  plan jsonb not null,
  manager_name text,
  status text not null default 'waiting' check (status in ('waiting','completed','failed','cancelled')),
  current_action integer not null default 0,
  next_run_at timestamptz,
  locked_at timestamptz,
  result jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz not null default (now() + interval '2 hours')
);
create index flow_email_test_runs_due on public.flow_email_test_runs(next_run_at) where status = 'waiting';
create index flow_email_test_runs_user on public.flow_email_test_runs(user_id,created_at desc);
alter table public.flow_email_test_runs enable row level security;
-- Only authenticated server routes may create, claim, cancel, or read a test.
revoke all on public.flow_email_test_runs from anon, authenticated;
grant all on public.flow_email_test_runs to service_role;
commit;
