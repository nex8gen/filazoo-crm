begin;
-- An uncapped legacy/beta workspace still needs accurate usage reporting and
-- must retain its calendar-month count if it later chooses a capped plan.
create or replace function crm_billing.enforce_flow_run_limit() returns trigger
language plpgsql security definer set search_path='' as $$
declare cap bigint; used bigint; period date:=date_trunc('month',now() at time zone 'Asia/Shanghai')::date;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text,1));
 cap:=(crm_billing.entitlement(new.workspace_id)#>>'{limits,flowRuns}')::bigint;
 insert into crm_billing.monthly_usage(workspace_id,period_start) values(new.workspace_id,period) on conflict do nothing;
 select flow_runs into used from crm_billing.monthly_usage where workspace_id=new.workspace_id and period_start=period for update;
 if cap is not null and used>=cap then raise exception 'Plan limit reached: monthly workflow runs. Review your subscription to add capacity.'; end if;
 update crm_billing.monthly_usage set flow_runs=flow_runs+1 where workspace_id=new.workspace_id and period_start=period;
 return new;
end $$;
insert into crm_billing.monthly_usage as counter(workspace_id,period_start,flow_runs)
 select workspace_id,date_trunc('month',started_at at time zone 'Asia/Shanghai')::date,count(*) from public.flow_runs
 where started_at>=date_trunc('month',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai' group by 1,2
on conflict(workspace_id,period_start) do update set flow_runs=greatest(counter.flow_runs,excluded.flow_runs);
commit;
