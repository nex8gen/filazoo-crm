begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter table public.mailbox_sync_state add column if not exists messages_revision uuid;
alter table public.mailbox_sync_state alter column messages_revision set default gen_random_uuid();
update public.mailbox_sync_state set messages_revision=gen_random_uuid() where messages_revision is null;
alter table public.mailbox_sync_state alter column messages_revision set not null;

create or replace function public.bump_mailbox_messages_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  new.messages_revision := gen_random_uuid();
  return new;
end;
$$;
revoke all on function public.bump_mailbox_messages_revision() from public,anon,authenticated;
grant execute on function public.bump_mailbox_messages_revision() to service_role,crm_workspace_server;
drop trigger if exists zz_mailbox_messages_revision on public.mailbox_sync_state;
create trigger zz_mailbox_messages_revision before update of messages,uid_validity on public.mailbox_sync_state
for each row execute function public.bump_mailbox_messages_revision();

-- Metadata-only polls must not name the messages/uid_validity columns. This
-- avoids history triggers and keeps unchanged message payloads reusable.
create or replace function public.commit_mail_sync_snapshot(
  p_account text,p_owner uuid,p_key text,p_lease uuid,p_snapshot jsonb
) returns boolean language plpgsql security invoker set search_path='' as $$
declare
  previous_mode text := current_setting('filazoo_mail.complete_snapshot',true);
  committed boolean;
begin
  perform 1 from public.mail_sync_accounts
    where account_key=p_account and lease_token=p_owner and lease_until>now() for update;
  if not found then return false; end if;
  perform set_config('filazoo_mail.complete_snapshot','on',true);
  if p_snapshot ? 'messages' then
    update public.mailbox_sync_state set
      messages=p_snapshot->'messages',uid_validity=(p_snapshot->>'uid_validity')::bigint,
      last_uid=(p_snapshot->>'last_uid')::bigint,
      synced_at=coalesce((p_snapshot->>'synced_at')::timestamptz,synced_at),
      reconciled_at=coalesce((p_snapshot->>'reconciled_at')::timestamptz,reconciled_at),
      last_error=case when p_snapshot->>'maintenance'='true' then last_error else null end,
      lease_token=null,lease_until=null
      where mailbox_key=p_key and lease_token=p_lease;
  else
    update public.mailbox_sync_state set
      last_uid=(p_snapshot->>'last_uid')::bigint,
      synced_at=coalesce((p_snapshot->>'synced_at')::timestamptz,synced_at),
      reconciled_at=coalesce((p_snapshot->>'reconciled_at')::timestamptz,reconciled_at),
      last_error=case when p_snapshot->>'maintenance'='true' then last_error else null end,
      lease_token=null,lease_until=null
      where mailbox_key=p_key and lease_token=p_lease;
  end if;
  committed := found;
  perform set_config('filazoo_mail.complete_snapshot',coalesce(previous_mode,''),true);
  return committed;
end;
$$;
notify pgrst,'reload schema';
commit;
