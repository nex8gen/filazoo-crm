begin;

-- Customer billing needs totals, not provider/model reservation records.
-- Keep the workspace and administrator checks inside the private RPC.
create or replace function crm_billing.billing_overview(p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w uuid := crm_tenancy.workspace_id(); e jsonb; usage jsonb;
begin
 if not exists(select 1 from public.workspace_members where workspace_id=w and user_id=p_actor_id and role='admin' and activated_at is not null) then raise insufficient_privilege; end if;
 perform crm_billing.sync_included_credits(w);
 e := crm_billing.entitlement(w);
 select jsonb_build_object(
  'companies',(select count(*) from public.companies where workspace_id=w),
  'products',(select count(*) from public.products where workspace_id=w),
  'mailboxes',(select count(*) from public.workspace_mailboxes where workspace_id=w),
  'flows',(select count(*) from public.flows where workspace_id=w),
  'flowRuns',coalesce((select flow_runs from crm_billing.monthly_usage where workspace_id=w and period_start=date_trunc('month',now() at time zone 'Asia/Shanghai')::date),0),
  'documentBytes',(select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects where bucket_id='workspace-documents' and name like w::text||'/%')
 ) into usage;
 return e || jsonb_build_object(
  'credits',crm_billing.credit_balance(w), 'usage',usage,
  'memberCount',(select count(*) from public.workspace_members where workspace_id=w and activated_at is not null)
 );
end $$;

commit;
