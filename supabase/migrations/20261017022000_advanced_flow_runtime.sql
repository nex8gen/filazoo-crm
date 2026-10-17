begin;

alter table public.flows drop constraint if exists flows_trigger_type_check;
alter table public.flows add constraint flows_trigger_type_check
  check (trigger_type in ('email_received','category_changed','no_reply','lead_added_to_list','company_segment_changed','pipeline_stage_changed'));

alter table public.flow_runs add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.flow_runs add column if not exists context jsonb not null default '{}'::jsonb;
create index if not exists flow_runs_company_id_idx on public.flow_runs(company_id);

create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  flow_run_id uuid references public.flow_runs(id) on delete set null,
  company_id uuid references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  notes text,
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  status text not null default 'open' check (status in ('open','done','cancelled')),
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.internal_notifications (
  id uuid primary key default gen_random_uuid(),
  flow_run_id uuid references public.flow_runs(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null default 'in_app' check (channel in ('in_app','email')),
  message text not null check (char_length(message) between 1 and 500),
  conversation_id text,
  include_thread_link boolean not null default true,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists crm_tasks_assignee_status_due_idx on public.crm_tasks(assigned_to,status,due_at);
create index if not exists crm_tasks_company_idx on public.crm_tasks(company_id);
create index if not exists internal_notifications_user_created_idx on public.internal_notifications(user_id,created_at desc);

drop trigger if exists crm_tasks_set_updated_at on public.crm_tasks;
create trigger crm_tasks_set_updated_at before update on public.crm_tasks
for each row execute function public.set_updated_at();

alter table public.crm_tasks enable row level security;
alter table public.internal_notifications enable row level security;
revoke all on table public.crm_tasks, public.internal_notifications from anon, authenticated;
grant all on table public.crm_tasks, public.internal_notifications to service_role;

notify pgrst, 'reload schema';
commit;
