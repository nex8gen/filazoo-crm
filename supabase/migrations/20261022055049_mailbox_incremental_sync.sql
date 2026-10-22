begin;

-- Internal bounded mailbox cache, shared across server instances. The API
-- resolves the viewer's authorized mailbox before accessing its opaque key.
create table if not exists public.mailbox_sync_state (
  mailbox_key text primary key,
  uid_validity bigint,
  last_uid bigint not null default 0,
  messages jsonb not null default '[]'::jsonb,
  synced_at timestamptz,
  last_error text,
  lease_token uuid,
  lease_until timestamptz,
  check (last_uid >= 0),
  check (jsonb_typeof(messages) = 'array' and jsonb_array_length(messages) <= 1000)
);
alter table public.mailbox_sync_state enable row level security;
revoke all on public.mailbox_sync_state from anon, authenticated;
grant select, insert, update, delete on public.mailbox_sync_state to service_role;

create table if not exists public.mailbox_message_content (
  mailbox_key text not null references public.mailbox_sync_state(mailbox_key) on delete cascade,
  uid_validity bigint not null,
  uid bigint not null check (uid > 0),
  content jsonb not null,
  primary key (mailbox_key, uid_validity, uid)
);
alter table public.mailbox_message_content enable row level security;
revoke all on public.mailbox_message_content from anon, authenticated;
grant select, insert, update, delete on public.mailbox_message_content to service_role;

notify pgrst, 'reload schema';
commit;
