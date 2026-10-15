begin;

create table if not exists public.email_inbox_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_key text not null,
  category text check (category is null or category in ('Needs follow-up','Waiting on customer','Interested','Big order','No action')),
  starred boolean not null default false,
  folder text not null default 'inbox' check (folder in ('inbox','archive','trash')),
  follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, message_key)
);

create table if not exists public.email_automation_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mailbox_sent_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mailbox_id uuid references public.workspace_mailboxes(id) on delete set null,
  message_id text,
  from_email extensions.citext not null,
  to_email extensions.citext not null,
  subject text not null,
  body text not null default '',
  status text not null default 'sent' check (status in ('sent','failed')),
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists email_inbox_state_user_updated_idx
  on public.email_inbox_state(user_id, updated_at desc);
create index if not exists mailbox_sent_messages_user_sent_idx
  on public.mailbox_sent_messages(user_id, sent_at desc);

drop trigger if exists email_inbox_state_set_updated_at on public.email_inbox_state;
create trigger email_inbox_state_set_updated_at
before update on public.email_inbox_state
for each row execute function public.set_updated_at();

drop trigger if exists email_automation_settings_set_updated_at on public.email_automation_settings;
create trigger email_automation_settings_set_updated_at
before update on public.email_automation_settings
for each row execute function public.set_updated_at();

alter table public.email_inbox_state enable row level security;
alter table public.email_automation_settings enable row level security;
alter table public.mailbox_sent_messages enable row level security;

revoke all on table public.email_inbox_state from anon, authenticated;
revoke all on table public.email_automation_settings from anon, authenticated;
revoke all on table public.mailbox_sent_messages from anon, authenticated;
grant all on table public.email_inbox_state to service_role;
grant all on table public.email_automation_settings to service_role;
grant all on table public.mailbox_sent_messages to service_role;

notify pgrst, 'reload schema';

commit;
