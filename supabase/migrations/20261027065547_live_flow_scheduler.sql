begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Receipt boundaries prevent old mail from enrolling when a flow goes live.
alter table public.flows add column email_enrollment_started_at timestamptz;
update public.flows set email_enrollment_started_at = now()
where status = 'live' and trigger_type = 'email_received';

create function public.set_flow_email_enrollment_start()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.trigger_type = 'email_received' and new.status = 'live' then
    if tg_op = 'INSERT' then
      new.email_enrollment_started_at := now();
    elsif old.status <> 'live' or old.trigger_type <> 'email_received' then
      new.email_enrollment_started_at := now();
    else
      new.email_enrollment_started_at := old.email_enrollment_started_at;
    end if;
  else
    new.email_enrollment_started_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.set_flow_email_enrollment_start() from public, anon, authenticated;
create trigger flows_email_enrollment_start before insert or update on public.flows
for each row execute function public.set_flow_email_enrollment_start();

-- Only cron's database owner can read the scheduler credential from Vault.
-- Configure flow_cron_origin and flow_cron_secret in Vault, then enable jobs
-- after the matching application release has passed its health check.
select cron.schedule('filazoo-flow-resume', '* * * * *', $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'flow_cron_origin') || '/api/cron/flows?task=resume',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'flow_cron_secret')),
    timeout_milliseconds := 300000
  );
$job$);
select cron.schedule('filazoo-flow-inbox', '* * * * *', $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'flow_cron_origin') || '/api/cron/flows',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'flow_cron_secret')),
    timeout_milliseconds := 300000
  );
$job$);
select cron.alter_job(jobid, active := false) from cron.job
where jobname in ('filazoo-flow-resume', 'filazoo-flow-inbox');

notify pgrst, 'reload schema';
commit;
