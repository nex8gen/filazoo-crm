-- pg_net removes requests inside the worker transaction. Other connections
-- still see an in-flight queue row until that transaction completes, so this
-- guard also covers slow requests while avoiding minute-by-minute backlogs.
-- Keep each job's existing schedule and enabled state unchanged.
do $$
declare
  tick record;
begin
  for tick in select * from (values
    ('filazoo-flow-resume', '/api/cron/flows?task=resume', 300000),
    ('filazoo-flow-inbox', '/api/cron/flows', 300000),
    ('filazoo-customer-replies', '/api/cron/customer-replies', 240000)
  ) as ticks(job_name, path, timeout_ms)
  loop
    perform cron.alter_job(jobid, command := format($command$
      select net.http_get(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'flow_cron_origin') || %L,
        headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'flow_cron_secret')),
        timeout_milliseconds := %s
      )
      where not exists (
        select 1 from net.http_request_queue
        where url = (select decrypted_secret from vault.decrypted_secrets where name = 'flow_cron_origin') || %L
      );
    $command$, tick.path, tick.timeout_ms, tick.path))
    from cron.job where jobname = tick.job_name;
  end loop;
end;
$$;
