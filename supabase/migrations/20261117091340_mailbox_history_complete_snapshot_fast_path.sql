-- The fenced worker commits the complete, deduplicated snapshot produced by
-- synchronizeMailbox (including its 5,000-message bound). Re-merging that same
-- history in the legacy trigger sorts megabytes on every poll and can exceed
-- PostgREST's statement timeout during the initial import.
-- Restore the scoped setting after the update. An exception rolls back both
-- the update and set_config. Ordinary/legacy updates retain preservation.
-- No grants, tenant scoping, or ownership fencing change.
create or replace function public.commit_mail_sync_snapshot(
  p_account text,p_owner uuid,p_key text,p_lease uuid,p_snapshot jsonb
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  previous_mode text := current_setting('filazoo_mail.complete_snapshot',true);
  committed boolean;
begin
  perform 1 from public.mail_sync_accounts
    where account_key=p_account and lease_token=p_owner and lease_until>now() for update;
  if not found then return false; end if;
  perform set_config('filazoo_mail.complete_snapshot','on',true);
  update public.mailbox_sync_state set
    messages=case when p_snapshot ? 'messages' then p_snapshot->'messages' else messages end,
    uid_validity=(p_snapshot->>'uid_validity')::bigint,
    last_uid=(p_snapshot->>'last_uid')::bigint,
    synced_at=coalesce((p_snapshot->>'synced_at')::timestamptz,synced_at),
    reconciled_at=coalesce((p_snapshot->>'reconciled_at')::timestamptz,reconciled_at),
    last_error=case when p_snapshot->>'maintenance'='true' then last_error else null end,
    lease_token=null,lease_until=null
    where mailbox_key=p_key and lease_token=p_lease;
  committed := found;
  perform set_config('filazoo_mail.complete_snapshot',coalesce(previous_mode,''),true);
  return committed;
end $$;

create or replace function public.preserve_mailbox_history() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_setting('filazoo_mail.complete_snapshot', true) = 'on'
     and jsonb_array_length(new.messages) <= 5000 then
    return new;
  end if;
  if old.uid_validity is distinct from new.uid_validity then
    return new;
  end if;
  if old.messages is not distinct from new.messages then
    return new;
  end if;

  select coalesce(jsonb_agg(value order by source_rank, item_order), '[]'::jsonb)
  into new.messages
  from (
    select value, source_rank, item_order
    from (
      select distinct on (item_key) value, source_rank, item_order
      from (
        select value, coalesce(value->>'id', md5(value::text)) as item_key,
          0 as source_rank, ordinality as item_order
        from jsonb_array_elements(coalesce(new.messages, '[]'::jsonb)) with ordinality
        union all
        select value, coalesce(value->>'id', md5(value::text)) as item_key,
          1 as source_rank, ordinality as item_order
        from jsonb_array_elements(coalesce(old.messages, '[]'::jsonb)) with ordinality
      ) candidates
      order by item_key, source_rank, item_order
    ) deduplicated
    order by source_rank, item_order
    limit 5000
  ) bounded;
  return new;
end;
$$;
