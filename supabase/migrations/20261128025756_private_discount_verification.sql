begin;
set local lock_timeout='5s';

-- The service role cannot read auth.users directly. Reuse the existing private
-- verifier, which also excludes banned/deleted accounts, without broadening grants.
create or replace function public.check_credit_discount(p_user_id uuid,p_workspace_id uuid,p_code_hash text) returns jsonb
language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from crm_billing.credit_discounts d
  join public.workspaces w on w.id=d.workspace_id
  join public.workspace_members m on m.workspace_id=w.id and m.user_id=d.user_id
  where d.code_hash=p_code_hash and d.user_id=p_user_id and d.workspace_id=p_workspace_id and d.revoked_at is null
   and w.owner_id=p_user_id and m.role='admin' and m.activated_at is not null
   and exists(select 1 from crm_tenancy.verified_user(p_user_id)))
 then raise exception 'This discount code is not available for your account'; end if;
 if not coalesce(crm_billing.has_access(p_workspace_id),false) then raise exception 'An active subscription is required'; end if;
 return jsonb_build_object('discountPercent',100);
end $$;
revoke all on function public.check_credit_discount(uuid,uuid,text) from public,anon,authenticated,crm_workspace_server;
grant execute on function public.check_credit_discount(uuid,uuid,text) to service_role;

notify pgrst,'reload schema';
commit;
