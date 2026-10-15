begin;

create table if not exists public.workspace_mailboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  type text not null check (type in ('workspace','personal')),
  email extensions.citext not null unique,
  display_name text,
  is_default boolean not null default false,
  provider text not null default 'smtp' check (provider in ('smtp','google','microsoft','other')),
  notes text,
  smtp_host text,
  smtp_port integer,
  smtp_username text,
  smtp_password text,
  imap_host text,
  imap_port integer,
  imap_username text,
  imap_password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists workspace_mailboxes_set_updated_at on public.workspace_mailboxes;
create trigger workspace_mailboxes_set_updated_at
before update on public.workspace_mailboxes
for each row execute function public.set_updated_at();

alter table public.workspace_mailboxes enable row level security;

create unique index if not exists workspace_mailboxes_default_workspace_idx
  on public.workspace_mailboxes(type)
  where type = 'workspace' and is_default;

create unique index if not exists workspace_mailboxes_default_personal_idx
  on public.workspace_mailboxes(user_id)
  where type = 'personal' and is_default;

revoke all on table public.workspace_mailboxes from anon, authenticated;
grant all on table public.workspace_mailboxes to service_role;

notify pgrst, 'reload schema';

commit;
