-- Persistent work and account-wide ownership survive request/process termination.
create table public.mail_sync_accounts (
  account_key text primary key,
  mailbox_id uuid not null references public.workspace_mailboxes(id) on delete cascade,
  lease_token uuid,
  lease_until timestamptz
);
create table public.mail_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  account_key text not null references public.mail_sync_accounts(account_key) on delete cascade,
  kind text not null check (kind in ('inbox','folder','history','flags','previews','discovery')),
  folder text not null default 'INBOX',
  state text not null default 'queued' check (state in ('queued','running','idle')),
  priority integer not null default 10,
  next_run_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  lease_token uuid,
  unique(account_key,kind,folder)
);
create index mail_sync_jobs_due on public.mail_sync_jobs(next_run_at,priority) where state <> 'idle';
create index mail_sync_accounts_mailbox on public.mail_sync_accounts(mailbox_id);
alter table public.mail_sync_accounts enable row level security;
alter table public.mail_sync_jobs enable row level security;
revoke all on public.mail_sync_accounts, public.mail_sync_jobs from public, anon, authenticated;
grant all on public.mail_sync_accounts, public.mail_sync_jobs to service_role;

create function public.claim_mail_sync_job(p_token uuid)
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
    order by j.priority, j.next_run_at for update skip locked limit 1;
  if not found then return; end if;
  update public.mail_sync_accounts set lease_token=p_token, lease_until=now()+interval '5 minutes' where account_key=account.account_key;
  update public.mail_sync_jobs set state='running',lease_token=p_token,last_attempt_at=now() where id=job.id returning * into job;
  return next job;
end $$;

create function public.renew_mail_sync_lease(p_account text,p_token uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.mail_sync_accounts set lease_until=now()+interval '5 minutes'
    where account_key=p_account and lease_token=p_token and lease_until > now();
  return found;
end $$;

create function public.finish_mail_sync_job(p_job uuid,p_token uuid,p_error text,p_delay integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare job public.mail_sync_jobs;
begin
  select j.* into job from public.mail_sync_jobs j where j.id=p_job;
  if not found then return false; end if;
  perform 1 from public.mail_sync_accounts where account_key=job.account_key and lease_token=p_token and lease_until>now() for update;
  if not found then return false; end if;
  update public.mail_sync_jobs set
    state=case when p_error is null and kind='history' then 'idle' else 'queued' end,
    attempts=case when p_error is null then 0 else attempts+1 end,
    last_error=p_error,
    last_success_at=case when p_error is null then now() else last_success_at end,
    next_run_at=now()+make_interval(secs=>greatest(10,least(3600,p_delay))),lease_token=null
    where id=p_job and lease_token=p_token;
  if not found then return false; end if;
  update public.mail_sync_accounts set lease_token=null,lease_until=null where account_key=job.account_key and lease_token=p_token;
  return true;
end $$;

-- Fence snapshot commits against expired/replaced account owners.
create function public.commit_mail_sync_snapshot(p_account text,p_owner uuid,p_key text,p_lease uuid,p_snapshot jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.mail_sync_accounts where account_key=p_account and lease_token=p_owner and lease_until>now() for update;
  if not found then return false; end if;
  update public.mailbox_sync_state set
    messages=case when p_snapshot ? 'messages' then p_snapshot->'messages' else messages end,
    uid_validity=(p_snapshot->>'uid_validity')::bigint,
    last_uid=(p_snapshot->>'last_uid')::bigint,
    synced_at=coalesce((p_snapshot->>'synced_at')::timestamptz,synced_at),
    reconciled_at=coalesce((p_snapshot->>'reconciled_at')::timestamptz,reconciled_at),
    last_error=case when p_snapshot->>'maintenance'='true' then last_error else null end,
    lease_token=null,lease_until=null
    where mailbox_key=p_key and lease_token=p_lease;
  return found;
end $$;
revoke all on function public.claim_mail_sync_job(uuid), public.renew_mail_sync_lease(text,uuid), public.finish_mail_sync_job(uuid,uuid,text,integer), public.commit_mail_sync_snapshot(text,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_mail_sync_job(uuid), public.renew_mail_sync_lease(text,uuid), public.finish_mail_sync_job(uuid,uuid,text,integer), public.commit_mail_sync_snapshot(text,uuid,text,uuid,jsonb) to service_role;

-- Independent receive-only worker, with the same vault credentials as existing cron.
-- Queued jobs remain durable even if a tick or HTTP process fails.
select cron.schedule('filazoo-mail-sync','* * * * *',$command$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name='flow_cron_origin') || '/api/cron/mail-sync',
    headers := jsonb_build_object('Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='flow_cron_secret')),
    timeout_milliseconds := 300000
  ) where not exists (select 1 from net.http_request_queue where url=(select decrypted_secret from vault.decrypted_secrets where name='flow_cron_origin') || '/api/cron/mail-sync');
$command$);
-- Enable after deploying the matching API; avoid calling an unavailable route.
select cron.alter_job(jobid, active:=false) from cron.job where jobname='filazoo-mail-sync';
