begin;

-- Persist receipt identity before downloading a body. Workflow facts must see
-- a real reply even when content hydration or AI is temporarily unavailable.
alter table public.emails add column if not exists mailbox_id uuid;
alter table public.emails add column if not exists mailbox_uid bigint;
alter table public.emails add column if not exists mailbox_uid_validity bigint;
alter table public.emails add column if not exists body_loaded boolean not null default true;
alter table public.emails add column if not exists automatic_response boolean not null default false;
-- One real message may reach two personal inboxes. Keep both receipts without
-- overwriting personal ownership; the response claim still deduplicates replies.
alter table public.emails drop constraint if exists emails_message_id_key;
create unique index if not exists emails_mailbox_message_key on public.emails(workspace_id,mailbox_id,message_id) where mailbox_id is not null;
create unique index if not exists emails_legacy_message_key on public.emails(workspace_id,message_id) where mailbox_id is null;
create index if not exists emails_workflow_receipts_idx on public.emails(workspace_id,mailbox_id,created_at,id) where direction='received';
create index if not exists emails_workflow_reply_idx on public.emails(workspace_id,contact_id,owner_id,created_at) where direction='received';
create index if not exists contacts_workflow_company_idx on public.contacts(workspace_id,company_id,id);
create index if not exists flow_run_logs_workspace_run_idx on public.flow_run_logs(workspace_id,run_id,created_at);
create index if not exists flow_run_logs_workspace_step_idx on public.flow_run_logs(workspace_id,step_id);
create index if not exists mailbox_sent_workflow_recipient_idx on public.mailbox_sent_messages(workspace_id,to_email,sent_at) where status='sent';

-- Retain the existing workspace RLS on emails. The extra mailbox fields never
-- broaden read authorization; personal messages keep their existing owner_id.
create or replace function public.protect_workflow_segment() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.flows f where f.workspace_id=old.workspace_id
    and f.trigger_config->>'savedSegmentId'=old.id::text
    and (f.status='live' or exists(select 1 from public.flow_runs r where r.workspace_id=f.workspace_id and r.flow_id=f.id and r.status='active'))) then
    raise exception 'This segment is used by a live or waiting workflow. Update its audience and resolve waiting runs before deleting it.';
  end if;
  return old;
end;
$$;
revoke all on function public.protect_workflow_segment() from public,anon,authenticated;
drop trigger if exists company_segments_protect_workflows on public.company_segments;
create trigger company_segments_protect_workflows before delete on public.company_segments
for each row execute function public.protect_workflow_segment();

-- Each provider workload has a separate function lifetime. The original inbox
-- tick now projects receipts/enrolls; resume only advances saved action cursors.
select cron.schedule('filazoo-scheduled-email','* * * * *',$job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name='flow_cron_origin') || '/api/cron/flows?task=scheduled-email',
    headers := jsonb_build_object('Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='flow_cron_secret')),
    timeout_milliseconds := 300000
  ) where not exists(select 1 from net.http_request_queue where url=(select decrypted_secret from vault.decrypted_secrets where name='flow_cron_origin') || '/api/cron/flows?task=scheduled-email');
$job$);
select cron.schedule('filazoo-automatic-replies','* * * * *',$job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name='flow_cron_origin') || '/api/cron/flows?task=automatic-replies',
    headers := jsonb_build_object('Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='flow_cron_secret')),
    timeout_milliseconds := 300000
  ) where not exists(select 1 from net.http_request_queue where url=(select decrypted_secret from vault.decrypted_secrets where name='flow_cron_origin') || '/api/cron/flows?task=automatic-replies');
$job$);
-- Enable only after the compatible application is deployed and verified.
select cron.alter_job(jobid,active:=false) from cron.job where jobname in('filazoo-scheduled-email','filazoo-automatic-replies');
notify pgrst,'reload schema';
commit;
