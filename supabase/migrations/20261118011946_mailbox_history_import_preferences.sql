-- Existing accounts keep their established import scope. Connection forms save
-- the smaller, explicit new-account defaults. This does not delete any history.
alter table public.workspace_mailboxes
  add column sync_preferences jsonb not null default '{"historyLimit":5000,"historyFolders":"all","historyPaused":false}'::jsonb,
  add constraint workspace_mailboxes_sync_preferences_check check (
    jsonb_typeof(sync_preferences) = 'object'
    and sync_preferences ?& array['historyLimit','historyFolders','historyPaused']
    and jsonb_typeof(sync_preferences->'historyLimit') = 'number'
    and (sync_preferences->>'historyLimit') in ('50','100','500','1000','2500','5000')
    and (sync_preferences->>'historyFolders') in ('inbox_sent','all')
    and jsonb_typeof(sync_preferences->'historyPaused') = 'boolean'
  );

-- New mail stays first. Maintenance overdue for five minutes gets a turn
-- before continuing history, so a large import cannot starve previews/flags.
create or replace function public.claim_mail_sync_job(p_token uuid)
returns setof public.mail_sync_jobs language plpgsql security invoker set search_path = '' as $$
declare account public.mail_sync_accounts; job public.mail_sync_jobs;
begin
  select a.* into account from public.mail_sync_accounts a
    where (a.lease_until is null or a.lease_until < now())
      and exists (select 1 from public.mail_sync_jobs j where j.account_key=a.account_key and j.state <> 'idle' and j.next_run_at <= now())
    order by (select min(j.next_run_at) from public.mail_sync_jobs j where j.account_key=a.account_key and j.state <> 'idle')
    for update skip locked limit 1;
  if not found then return; end if;
  select j.* into job from public.mail_sync_jobs j where j.account_key=account.account_key
    and j.state <> 'idle' and j.next_run_at <= now()
    order by case when j.kind='inbox' then 0
      when j.kind <> 'history' and j.next_run_at<now()-interval '5 minutes' then 1
      when j.kind='history' then 2
      when j.kind='previews' and j.folder='INBOX' then 3
      when j.kind='discovery' then 4 else 5 end,
      j.priority, j.next_run_at for update skip locked limit 1;
  if not found then return; end if;
  update public.mail_sync_accounts set lease_token=p_token, lease_until=now()+interval '5 minutes' where account_key=account.account_key;
  update public.mail_sync_jobs set state='running',lease_token=p_token,last_attempt_at=now() where id=job.id returning * into job;
  return next job;
end $$;
revoke all on function public.claim_mail_sync_job(uuid) from public,anon,authenticated;
grant execute on function public.claim_mail_sync_job(uuid) to service_role;
