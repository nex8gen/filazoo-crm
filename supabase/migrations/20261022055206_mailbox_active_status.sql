alter table public.workspace_mailboxes
  add column if not exists is_active boolean not null default true;
