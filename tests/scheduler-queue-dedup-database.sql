-- No HTTP request is dispatched: pg_net waits for commit, and this rolls back.
begin;

do $$
declare
  tick record;
  origin text := 'https://scheduler-verification.invalid/' || gen_random_uuid()::text;
  before_count bigint;
  after_count bigint;
begin
  -- Isolate these checks from the real worker queue and real HTTP targets.
  for tick in select jobname, command from cron.job
    where jobname in ('filazoo-flow-resume', 'filazoo-flow-inbox', 'filazoo-customer-replies')
  loop
    if position('where not exists' in lower(tick.command)) = 0 then
      raise exception 'Missing queue guard for %', tick.jobname;
    end if;
    -- Substitute origin and credential lookups; neither secrets nor real
    -- destinations are involved in these rolled-back test requests.
    tick.command := replace(tick.command,
      '(select decrypted_secret from vault.decrypted_secrets where name = ''flow_cron_origin'')',
      quote_literal(origin));
    tick.command := replace(tick.command,
      '(select decrypted_secret from vault.decrypted_secrets where name = ''flow_cron_secret'')',
      quote_literal('test-only'));
    select count(*) into before_count from net.http_request_queue where url like origin || '%';
    execute tick.command;
    select count(*) into after_count from net.http_request_queue where url like origin || '%';
    if after_count <> before_count + 1 then
      raise exception 'First tick not queued for %', tick.jobname;
    end if;
    execute tick.command;
    if (select count(*) from net.http_request_queue where url like origin || '%') <> after_count then
      raise exception 'Duplicate pending tick queued for %', tick.jobname;
    end if;
  end loop;
end;
$$;

select 'Scheduler queue assertions passed; no HTTP requests committed' as result;
rollback;
