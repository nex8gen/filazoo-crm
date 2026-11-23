-- Run after the gate_mail_sync_dispatch migration. Every fixture is temporary;
-- no mailbox, workflow, real HTTP request or customer record is changed.
begin;
create temporary table dispatch_mailboxes(workspace_id text,is_active boolean,imap_host text,imap_username text,imap_password text);
create temporary table dispatch_workers(workspace_id text,mailbox_key text,lease_token text,lease_until timestamptz);
create temporary table dispatch_tags(revision bigint,processed_revision bigint,next_attempt_at timestamptz,lease_until timestamptz);
create temporary table dispatch_http_queue(url text);
create temporary table dispatch_tag_state(next_check_at timestamptz);
create temporary table dispatch_workspaces(id text);
create temporary table dispatch_companies(workspace_id text);
create temporary table dispatch_runtime(workspace_id text,phase text);

create function pg_temp.assert_mail_dispatch(expected boolean) returns void language plpgsql as $$
declare command text; predicate text; actual boolean;
begin
  select j.command into strict command from cron.job j where j.jobname='filazoo-mail-sync';
  if position('public.workspace_mailboxes' in command)=0 then raise exception 'Install the dispatcher gate first'; end if;
  predicate:=substring(command from position('where not exists' in command));
  predicate:=regexp_replace(predicate,';[[:space:]]*$','');
  predicate:=replace(predicate,'public.workspace_mailboxes','pg_temp.dispatch_mailboxes');
  predicate:=replace(predicate,'public.mailbox_sync_state','pg_temp.dispatch_workers');
  predicate:=replace(predicate,'public.crm_customer_tag_work','pg_temp.dispatch_tags');
  predicate:=replace(predicate,'public.crm_customer_tag_state','pg_temp.dispatch_tag_state');
  predicate:=replace(predicate,'public.workspaces','pg_temp.dispatch_workspaces');
  predicate:=replace(predicate,'public.companies','pg_temp.dispatch_companies');
  predicate:=replace(predicate,'public.crm_tag_runtime_state','pg_temp.dispatch_runtime');
  predicate:=replace(predicate,'net.http_request_queue','pg_temp.dispatch_http_queue');
  predicate:=replace(predicate,'(select decrypted_secret from vault.decrypted_secrets where name=''flow_cron_origin'')','''https://crm.fixture''');
  execute 'select exists(select 1 '||predicate||')' into actual;
  if actual is distinct from expected then raise exception 'Dispatch expected %, got %',expected,actual; end if;
end $$;

select pg_temp.assert_mail_dispatch(false); -- Empty installation.
insert into dispatch_mailboxes values('a',true,'imap.fixture','fixture','fixture');
select pg_temp.assert_mail_dispatch(true); -- New mailbox with no worker yet.
insert into dispatch_workers values('a','system:mail-sync-worker','owner',now()+interval '1 minute');
select pg_temp.assert_mail_dispatch(false); -- A warm worker owns receiving.
insert into dispatch_mailboxes values('b',true,'imap.fixture','fixture','fixture');
select pg_temp.assert_mail_dispatch(true); -- A second workspace cannot starve.
delete from dispatch_mailboxes where workspace_id='b';
update dispatch_workers set lease_until=now()-interval '1 second';
select pg_temp.assert_mail_dispatch(true); -- Crashed workers recover.
update dispatch_workers set lease_until=now()+interval '1 minute';
insert into dispatch_tags values(2,1,now(),null);
select pg_temp.assert_mail_dispatch(true); -- Tags are independent of receiving.
update dispatch_tags set lease_until=now()+interval '1 minute';
select pg_temp.assert_mail_dispatch(false); -- Already-owned tag jobs do not wake.
update dispatch_tags set lease_until=null,next_attempt_at=now()+interval '1 minute';
select pg_temp.assert_mail_dispatch(false); -- Retry backoff is honored.
update dispatch_tags set next_attempt_at=now();
insert into dispatch_http_queue values('https://crm.fixture/api/cron/mail-sync');
select pg_temp.assert_mail_dispatch(false); -- An enqueued HTTP wake-up deduplicates.
delete from dispatch_http_queue;
update dispatch_tags set processed_revision=revision;
update dispatch_workers set lease_until=now()-interval '1 second';
update dispatch_mailboxes set is_active=false;
select pg_temp.assert_mail_dispatch(false); -- Disabled mailboxes remain stopped.
insert into dispatch_tag_state values(now());
select pg_temp.assert_mail_dispatch(true); -- Time-based facts update without mail.
update dispatch_tag_state set next_check_at=now()+interval '1 day';
select pg_temp.assert_mail_dispatch(false);
insert into dispatch_workspaces values('a');
insert into dispatch_companies values('a');
select pg_temp.assert_mail_dispatch(true); -- Initial historical facts get seeded.
insert into dispatch_runtime values('a','done');
select pg_temp.assert_mail_dispatch(false); -- Completed backfill stays quiet.
rollback;
