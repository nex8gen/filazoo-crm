-- Stopped/replaced identities are retired by the worker. Completion must not
-- requeue that identity; re-enabling the mailbox explicitly reactivates it.
create or replace function public.finish_mail_sync_job(p_job uuid,p_token uuid,p_error text,p_delay integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare job public.mail_sync_jobs;
begin
  select j.* into job from public.mail_sync_jobs j where j.id=p_job;
  if not found then return false; end if;
  perform 1 from public.mail_sync_accounts where account_key=job.account_key and lease_token=p_token and lease_until>now() for update;
  if not found then return false; end if;
  update public.mail_sync_jobs set
    state=case when state='idle' or (p_error is null and kind='history') then 'idle' else 'queued' end,
    attempts=case when p_error is null then 0 else attempts+1 end,
    last_error=p_error,
    last_success_at=case when p_error is null then now() else last_success_at end,
    next_run_at=now()+make_interval(secs=>greatest(10,least(3600,p_delay))),lease_token=null
    where id=p_job and lease_token=p_token;
  if not found then return false; end if;
  update public.mail_sync_accounts set lease_token=null,lease_until=null where account_key=job.account_key and lease_token=p_token;
  return true;
end $$;
revoke all on function public.finish_mail_sync_job(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.finish_mail_sync_job(uuid,uuid,text,integer) to service_role;
