begin;

create table if not exists public.flows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  trigger_type text not null check (trigger_type in ('email_received','category_changed','no_reply','lead_added_to_list')),
  trigger_config jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','live','paused')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flow_steps (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows(id) on delete cascade,
  position integer not null check (position >= 0),
  type text not null check (type in ('wait','if_condition','send_email','create_task','change_category','internal_alert','stop')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (flow_id, position)
);

create table if not exists public.flow_runs (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows(id) on delete cascade,
  conversation_id text not null,
  contact_id uuid references public.contacts(id) on delete set null,
  current_step integer not null default 0 check (current_step >= 0),
  status text not null default 'active' check (status in ('active','done','cancelled','failed')),
  next_run_at timestamptz,
  locked_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.flow_run_logs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.flow_runs(id) on delete cascade,
  step_id uuid references public.flow_steps(id) on delete set null,
  result jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists flows_user_updated_idx on public.flows(user_id, updated_at desc);
create index if not exists flows_created_by_idx on public.flows(created_by);
create index if not exists flow_steps_flow_position_idx on public.flow_steps(flow_id, position);
create index if not exists flow_runs_flow_id_idx on public.flow_runs(flow_id);
create index if not exists flow_runs_contact_id_idx on public.flow_runs(contact_id);
create index if not exists flow_runs_due_idx on public.flow_runs(status, next_run_at) where status = 'active';
create index if not exists flow_runs_conversation_idx on public.flow_runs(conversation_id);
create index if not exists flow_run_logs_run_created_idx on public.flow_run_logs(run_id, created_at);
create index if not exists flow_run_logs_step_id_idx on public.flow_run_logs(step_id);
create unique index if not exists flow_runs_one_active_conversation_idx
  on public.flow_runs(flow_id, conversation_id)
  where status = 'active';

drop trigger if exists flows_set_updated_at on public.flows;
create trigger flows_set_updated_at before update on public.flows
for each row execute function public.set_updated_at();

alter table public.flows enable row level security;
alter table public.flow_steps enable row level security;
alter table public.flow_runs enable row level security;
alter table public.flow_run_logs enable row level security;

revoke all on table public.flows, public.flow_steps, public.flow_runs, public.flow_run_logs from anon, authenticated;
grant all on table public.flows, public.flow_steps, public.flow_runs, public.flow_run_logs to service_role;

notify pgrst, 'reload schema';

commit;
