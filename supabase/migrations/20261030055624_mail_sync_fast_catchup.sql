alter table public.mail_sync_jobs add column progress jsonb not null default '{}'::jsonb;

drop function public.finish_mail_sync_job(uuid,uuid,text,integer);
create function public.finish_mail_sync_job(p_job uuid,p_token uuid,p_error text,p_delay integer,p_progress jsonb default '{}'::jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare job public.mail_sync_jobs;
begin
  select j.* into job from public.mail_sync_jobs j where j.id=p_job;
  if not found then return false; end if;
  perform 1 from public.mail_sync_accounts where account_key=job.account_key and lease_token=p_token and lease_until>now() for update;
  if not found then return false; end if;
  update public.mail_sync_jobs set
    state=case when state='idle' or (p_error is null and kind='history' and not coalesce((p_progress->>'hasMore')::boolean,false)) then 'idle' else 'queued' end,
    attempts=case when p_error is null then 0 else attempts+1 end,
    last_error=p_error,
    last_success_at=case when p_error is null then now() else last_success_at end,
    progress=case when p_error is null then progress || p_progress else progress end,
    next_run_at=now()+make_interval(secs=>greatest(case when p_error is null then 0 else 10 end,least(3600,p_delay))),lease_token=null
    where id=p_job and lease_token=p_token;
  if not found then return false; end if;
  update public.mail_sync_accounts set lease_token=null,lease_until=null where account_key=job.account_key and lease_token=p_token;
  return true;
end $$;
revoke all on function public.finish_mail_sync_job(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.finish_mail_sync_job(uuid,uuid,text,integer,jsonb) to service_role;

update public.mail_sync_jobs set priority=case
  when kind='inbox' then 0 when kind='previews' and folder='INBOX' then 1
  when kind='discovery' then 3 when kind='folder' then 5
  when kind='history' then 8 when kind='previews' then 15 else 20 end;
-- pg_cron 1.6 supports second-based intervals. Activation follows the verified rollout.
select cron.alter_job(jobid,schedule:='10 seconds') from cron.job where jobname='filazoo-mail-sync';
