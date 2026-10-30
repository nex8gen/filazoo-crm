-- Catch up headers before spending time on older snippets and flag scans.
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
    order by case when j.kind='inbox' then 0 when j.kind='history' then 1
      when j.kind='previews' and j.folder='INBOX' then 2 when j.kind='discovery' then 3
      when j.next_run_at<now()-interval '5 minutes' then 4 else 5 end,
      j.priority, j.next_run_at for update skip locked limit 1;
  if not found then return; end if;
  update public.mail_sync_accounts set lease_token=p_token, lease_until=now()+interval '5 minutes' where account_key=account.account_key;
  update public.mail_sync_jobs set state='running',lease_token=p_token,last_attempt_at=now() where id=job.id returning * into job;
  return next job;
end $$;
revoke all on function public.claim_mail_sync_job(uuid) from public,anon,authenticated;
grant execute on function public.claim_mail_sync_job(uuid) to service_role;
