-- Exercises the real constraints without preserving changes to any account.
begin;
do $$
declare box uuid; bad jsonb;
begin
  select id into box from public.workspace_mailboxes limit 1;
  if box is null then raise exception 'An existing mailbox is required'; end if;
  update public.workspace_mailboxes set sync_preferences='{"historyLimit":500,"historyFolders":"inbox_sent","historyPaused":false}'::jsonb where id=box;
  foreach bad in array array[
    '{}'::jsonb,
    '{"historyLimit":99999,"historyFolders":"all","historyPaused":false}'::jsonb,
    '{"historyLimit":500,"historyFolders":"all","historyPaused":"false"}'::jsonb
  ] loop
    begin
      update public.workspace_mailboxes set sync_preferences=bad where id=box;
      raise exception 'Invalid import settings were accepted';
    exception when check_violation then null;
    end;
  end loop;
  if has_function_privilege('anon','public.claim_mail_sync_job(uuid)','execute') then
    raise exception 'Anonymous callers can access the receive scheduler';
  end if;
end $$;
rollback;
