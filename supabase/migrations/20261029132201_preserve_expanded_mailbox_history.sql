create or replace function public.preserve_mailbox_history() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  item_key text;
  merged jsonb := '[]'::jsonb;
  seen jsonb := '{}'::jsonb;
begin
  if old.uid_validity is distinct from new.uid_validity then
    return new;
  end if;

  for item in
    select value from jsonb_array_elements(coalesce(new.messages, '[]'::jsonb))
    union all
    select value from jsonb_array_elements(coalesce(old.messages, '[]'::jsonb))
  loop
    exit when jsonb_array_length(merged) >= 5000;
    item_key := coalesce(item->>'id', md5(item::text));
    if not (seen ? item_key) then
      merged := merged || jsonb_build_array(item);
      seen := seen || jsonb_build_object(item_key, true);
    end if;
  end loop;

  new.messages := merged;
  return new;
end;
$$;

revoke all on function public.preserve_mailbox_history() from public, anon, authenticated;
grant execute on function public.preserve_mailbox_history() to service_role;

drop trigger if exists preserve_mailbox_history_before_update on public.mailbox_sync_state;
create trigger preserve_mailbox_history_before_update
before update of messages, uid_validity on public.mailbox_sync_state
for each row execute function public.preserve_mailbox_history();
