-- Roll back every fixture and queue mutation, including claims of expired work.
begin;
do $$
declare
  box uuid; job public.mail_sync_jobs; second public.mail_sync_jobs;
  first_token uuid := gen_random_uuid(); second_token uuid := gen_random_uuid();
  snapshot_token uuid := gen_random_uuid();
begin
  select id into box from public.workspace_mailboxes limit 1;
  if box is null then raise exception 'A mailbox fixture is required'; end if;
  insert into public.mail_sync_accounts(account_key,mailbox_id) values ('worker-rollback-fixture',box);
  insert into public.mail_sync_jobs(account_key,kind,next_run_at,priority) values ('worker-rollback-fixture','inbox','1900-01-01',-100),('worker-rollback-fixture','history','1900-01-01',-99);
  select * into job from public.claim_mail_sync_job(first_token);
  if job.account_key <> 'worker-rollback-fixture' or job.kind <> 'inbox' then raise exception 'Claim selected incorrect work'; end if;
  if exists(select 1 from public.claim_mail_sync_job(second_token) where account_key='worker-rollback-fixture') then raise exception 'Account-wide ownership was not exclusive'; end if;
  if not public.finish_mail_sync_job(job.id,first_token,null,30) then raise exception 'Completion failed'; end if;
  select * into job from public.claim_mail_sync_job(first_token);
  if job.kind <> 'history' then raise exception 'Independent history job was lost'; end if;
  if not public.finish_mail_sync_job(job.id,first_token,'Timeout',120) then raise exception 'Retry failed'; end if;
  if not exists(select 1 from public.mail_sync_jobs where id=job.id and attempts=1 and last_error='Timeout' and next_run_at>=now()+interval '119 seconds') then raise exception 'Retry was not durable'; end if;
  if not exists(select 1 from public.mail_sync_jobs where account_key='worker-rollback-fixture' and kind='inbox' and last_success_at is not null and last_error is null) then raise exception 'History failure erased inbox success'; end if;
  update public.mail_sync_jobs set next_run_at='1900-01-01' where id=job.id;
  select * into job from public.claim_mail_sync_job(first_token);
  update public.mail_sync_accounts set lease_until=now()-interval '1 second' where account_key='worker-rollback-fixture';
  select * into second from public.claim_mail_sync_job(second_token);
  if second.id <> job.id then raise exception 'Terminated worker was not recovered'; end if;
  if public.finish_mail_sync_job(job.id,first_token,null,30) then raise exception 'Stale owner completed a recovered job'; end if;
  insert into public.mailbox_sync_state(mailbox_key,uid_validity,last_uid,messages,lease_token) values ('worker-rollback-fixture',1,1,'[]',snapshot_token);
  if public.commit_mail_sync_snapshot('worker-rollback-fixture',first_token,'worker-rollback-fixture',snapshot_token,'{"uid_validity":1,"last_uid":2,"messages":[]}') then raise exception 'Stale owner committed a snapshot'; end if;
  if not public.commit_mail_sync_snapshot('worker-rollback-fixture',second_token,'worker-rollback-fixture',snapshot_token,'{"uid_validity":1,"last_uid":2,"messages":[]}') then raise exception 'Current owner could not commit'; end if;
  if not public.finish_mail_sync_job(job.id,second_token,null,0,'{"hasMore":true,"imported":200}') then raise exception 'Recovered history batch could not finish'; end if;
  if not exists(select 1 from public.mail_sync_jobs where id=job.id and state='queued' and (progress->>'hasMore')::boolean and next_run_at<=now()) then raise exception 'History continuation was not queued immediately'; end if;
  update public.mail_sync_jobs set next_run_at='1900-01-01' where id=job.id;
  select * into job from public.claim_mail_sync_job(second_token);
  if not public.finish_mail_sync_job(job.id,second_token,null,30,'{"hasMore":false,"completed":true}') then raise exception 'Recovered job could not finish'; end if;
  if not exists(select 1 from public.mail_sync_jobs where id=job.id and state='idle' and attempts=0) then raise exception 'History completion did not become idle'; end if;
  update public.mail_sync_jobs set next_run_at='1900-01-01' where account_key='worker-rollback-fixture' and kind='inbox';
  select * into job from public.claim_mail_sync_job(first_token);
  update public.mail_sync_jobs set state='idle' where id=job.id;
  perform public.finish_mail_sync_job(job.id,first_token,null,30);
  if not exists(select 1 from public.mail_sync_jobs where id=job.id and state='idle') then raise exception 'Retired identity was requeued'; end if;
  insert into public.mail_sync_jobs(account_key,kind,next_run_at,priority) values
    ('worker-rollback-fixture','folder',now()-interval '1 second',5),
    ('worker-rollback-fixture','previews','1900-01-01',40);
  select * into job from public.claim_mail_sync_job(first_token);
  if job.kind <> 'previews' then raise exception 'Overdue maintenance was starved by folder polling'; end if;
  if has_table_privilege('authenticated','public.mail_sync_jobs','select') or has_function_privilege('anon','public.claim_mail_sync_job(uuid)','execute') then raise exception 'Worker access exposed to browser roles'; end if;
end $$;
rollback;
