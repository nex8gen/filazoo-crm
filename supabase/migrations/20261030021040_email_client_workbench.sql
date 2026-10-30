begin;
create table public.email_workbench_drafts (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 512),
  mailbox_id uuid not null references public.workspace_mailboxes(id) on delete cascade,
  revision bigint not null default 0,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index email_workbench_drafts_mailbox on public.email_workbench_drafts(user_id, mailbox_id, updated_at desc) where deleted_at is null;
alter table public.email_workbench_drafts enable row level security;
revoke all on public.email_workbench_drafts from public, anon, authenticated;
grant select, insert, update, delete on public.email_workbench_drafts to service_role;

-- A late autosave must never overwrite a newer draft or resurrect a sent draft.
create function public.save_email_workbench_draft(p_user uuid, p_id text, p_mailbox uuid, p_revision bigint, p_payload jsonb, p_deleted boolean default false)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare saved boolean;
begin
  insert into public.email_workbench_drafts(user_id,id,mailbox_id,revision,payload,deleted_at)
  values(p_user,p_id,p_mailbox,p_revision,p_payload,case when p_deleted then now() else null end)
  on conflict(user_id,id) do update set
    mailbox_id=excluded.mailbox_id, revision=excluded.revision, payload=excluded.payload,
    deleted_at=excluded.deleted_at, updated_at=now()
  where public.email_workbench_drafts.revision < excluded.revision
    and (public.email_workbench_drafts.deleted_at is null or p_deleted)
  returning true into saved;
  if saved then return true; end if;
  return exists(select 1 from public.email_workbench_drafts where user_id=p_user and id=p_id
    and revision=p_revision and payload=p_payload and (deleted_at is null or p_deleted));
end $$;
revoke all on function public.save_email_workbench_draft(uuid,text,uuid,bigint,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.save_email_workbench_draft(uuid,text,uuid,bigint,jsonb,boolean) to service_role;

create table public.email_send_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  request_hash text not null,
  payload jsonb not null,
  status text not null check(status in ('scheduled','preparing','submitting','sent','failed','uncertain','cancelled')),
  scheduled_at timestamptz,
  updated_at timestamptz not null default now(),
  result jsonb,
  error text,
  primary key(user_id,id)
);
create index email_send_operations_due on public.email_send_operations(scheduled_at) where status='scheduled';
alter table public.email_send_operations enable row level security;
revoke all on public.email_send_operations from public,anon,authenticated;
grant select,insert,update,delete on public.email_send_operations to service_role;

create table public.mailbox_provider_folders (
  mailbox_key text primary key,
  folders jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null default now()
);
alter table public.mailbox_provider_folders enable row level security;
revoke all on public.mailbox_provider_folders from public,anon,authenticated;
grant select,insert,update,delete on public.mailbox_provider_folders to service_role;
alter table public.mailbox_sync_state add column if not exists reconciled_at timestamptz;
alter table public.mailbox_sent_messages add column if not exists to_recipients jsonb not null default '[]'::jsonb;
alter table public.mailbox_sent_messages add column if not exists cc_recipients jsonb not null default '[]'::jsonb;
alter table public.mailbox_sent_messages add column if not exists bcc_recipients jsonb not null default '[]'::jsonb;
notify pgrst, 'reload schema';
commit;
