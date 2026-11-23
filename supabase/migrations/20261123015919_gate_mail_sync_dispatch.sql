-- Preserve the ten-second wake-up and warm IMAP connections. PostgreSQL can
-- avoid an HTTP invocation when every receiving workspace already has a worker.
-- Pending customer-tag work must still wake the route independently of mail.
begin;
set local lock_timeout = '5s';

select cron.alter_job(jobid, command := $command$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name='flow_cron_origin') || '/api/cron/mail-sync',
    headers := jsonb_build_object('Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='flow_cron_secret')),
    timeout_milliseconds := 300000
  ) where not exists (
    select 1 from net.http_request_queue
    where url=(select decrypted_secret from vault.decrypted_secrets where name='flow_cron_origin') || '/api/cron/mail-sync'
  ) and (
    exists (
      select 1 from public.workspace_mailboxes m
      where m.is_active and nullif(m.imap_host,'') is not null
        and nullif(m.imap_username,'') is not null and nullif(m.imap_password,'') is not null
        and not exists (
          select 1 from public.mailbox_sync_state s
          where s.workspace_id=m.workspace_id and s.mailbox_key='system:mail-sync-worker'
            and s.lease_token is not null and s.lease_until>now()
        )
    ) or exists (
      select 1 from public.crm_customer_tag_work w
      where w.revision>w.processed_revision and w.next_attempt_at<=now()
        and (w.lease_until is null or w.lease_until<=now())
    ) or exists (
      select 1 from public.crm_customer_tag_state s where s.next_check_at<=now()
    ) or exists (
      select 1 from public.workspaces w
      where exists (select 1 from public.companies c where c.workspace_id=w.id)
        and not exists (select 1 from public.crm_tag_runtime_state r where r.workspace_id=w.id and r.phase='done')
    )
  );
$command$) from cron.job where jobname='filazoo-mail-sync';

commit;
