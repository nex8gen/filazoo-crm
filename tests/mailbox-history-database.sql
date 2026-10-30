-- Live-database regression check: all fixture changes are rolled back.
begin;
set local role service_role;

do $$
declare
  fixture_key text := 'history-verification-' || gen_random_uuid()::text;
  saved jsonb;
begin
  insert into public.mailbox_sync_state(mailbox_key, uid_validity, last_uid, messages)
  values (fixture_key, 1, 2, '[{"id":"two","subject":"old"},{"id":"one"}]');

  -- The fast path must retain the entire identical snapshot.
  update public.mailbox_sync_state set messages = messages, synced_at = now()
  where mailbox_key = fixture_key;
  select messages into saved from public.mailbox_sync_state where mailbox_key = fixture_key;
  if saved <> '[{"id":"two","subject":"old"},{"id":"one"}]'::jsonb then
    raise exception 'Unchanged history was modified';
  end if;

  -- Old deployments can submit a short snapshot; history remains preserved,
  -- with the incoming copy winning for duplicate message IDs.
  update public.mailbox_sync_state
  set messages = '[{"id":"three"},{"id":"two","subject":"new"}]', last_uid = 3
  where mailbox_key = fixture_key;
  select messages into saved from public.mailbox_sync_state where mailbox_key = fixture_key;
  if saved <> '[{"id":"three"},{"id":"two","subject":"new"},{"id":"one"}]'::jsonb then
    raise exception 'History merge lost messages or duplicate precedence';
  end if;

  -- New deployments update metadata alone for empty polls.
  update public.mailbox_sync_state set last_uid = 4, synced_at = now(), lease_token = null, lease_until = null
  where mailbox_key = fixture_key;
  if (select messages from public.mailbox_sync_state where mailbox_key = fixture_key) <> saved then
    raise exception 'Metadata-only sync changed history';
  end if;

  update public.mailbox_sync_state set uid_validity = 2, last_uid = 0, messages = '[]'
  where mailbox_key = fixture_key;
  if (select messages from public.mailbox_sync_state where mailbox_key = fixture_key) <> '[]'::jsonb then
    raise exception 'Epoch reset retained obsolete messages';
  end if;

  update public.mailbox_sync_state set messages = (
    select jsonb_agg(jsonb_build_object('id', n::text)) from generate_series(1, 5001) n
  ) where mailbox_key = fixture_key;
  if (select jsonb_array_length(messages) from public.mailbox_sync_state where mailbox_key = fixture_key) <> 5000 then
    raise exception 'Mailbox history exceeded its bound';
  end if;
end;
$$;

select 'Mailbox history assertions passed; fixture transaction rolled back' as result;
rollback;
