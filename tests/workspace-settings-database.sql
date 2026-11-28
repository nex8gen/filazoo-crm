-- Run with a privileged connection. All fixtures and writes roll back.
begin;
set local lock_timeout = '5s';
do $$
declare tenant uuid := gen_random_uuid(); other_tenant uuid := gen_random_uuid(); actor uuid; other_actor uuid;
  n integer; before_count integer;
begin
  select id into actor from auth.users where deleted_at is null order by created_at limit 1;
  select id into other_actor from auth.users where deleted_at is null and id <> actor order by created_at limit 1;
  if actor is null or other_actor is null then raise exception 'Two existing users are required for this test'; end if;
  insert into public.workspaces(id,name,slug,owner_id) values
    (tenant,'Schedule test','schedule-test-' || tenant,actor),
    (other_tenant,'Other schedule test','schedule-test-' || other_tenant,actor);
  insert into crm_billing.complimentary_subscriptions(workspace_id,plan_id,seats,reason)
    values(tenant,'business',5,'Rolled-back workspace settings test'),(other_tenant,'business',5,'Rolled-back workspace settings test');
  perform set_config('request.headers',jsonb_build_object('x-crm-user-id',actor)::text,true);
  insert into public.workspace_members(workspace_id,user_id,role,display_name,activated_at) values
    (tenant,actor,'admin','Test admin',now()),(tenant,other_actor,'viewer','Test viewer',now()),
    (other_tenant,actor,'admin','Test admin',now());
  select count(*) into before_count from public.workspace_activity where workspace_id=tenant;
  update public.workspaces set website='https://example.com',timezone='America/New_York',
    business_hours='{"days":[1,2,3,4,5],"start":"08:30","end":"16:30"}' where id=tenant;
  if not exists(select 1 from public.workspace_activity where workspace_id=tenant and actor_id=actor
    and area='workspaces' and changed_fields @> array['website','timezone','business_hours']) then raise exception 'Workspace settings audit missing'; end if;
  update public.workspaces set updated_at=now() where id=tenant;
  select count(*) into n from public.workspace_activity where workspace_id=tenant;
  if n <> before_count+1 then raise exception 'No-op write generated activity'; end if;
  begin
    update public.workspaces set timezone='Invalid/Zone' where id=tenant;
    raise exception 'Timezone validation was bypassed';
  exception when raise_exception then if sqlerrm <> 'Invalid workspace timezone' then raise; end if; end;
  begin
    update public.workspaces set business_hours='{"days":[],"start":"09:00","end":"17:00"}' where id=tenant;
    raise exception 'Business hours validation was bypassed';
  exception when raise_exception then if sqlerrm <> 'Invalid workspace business hours' then raise; end if; end;
  begin
    update public.workspaces set business_hours='{"days":[1],"start":null,"end":"17:00"}' where id=tenant;
    raise exception 'Null hours validation was bypassed';
  exception when raise_exception then if sqlerrm <> 'Invalid workspace business hours' then raise; end if; end;
  -- Keep runtime logs free of credentials even when credentials are changed.
  insert into public.workspace_mailboxes(workspace_id,user_id,type,email,provider,smtp_password)
    values(tenant,actor,'workspace','audit-test@example.com','smtp','never-log-this-password');
  if exists(select 1 from public.workspace_activity where workspace_id=tenant and to_jsonb(workspace_activity)::text like '%never-log-this-password%') then raise exception 'Audit leaked credentials'; end if;
  perform set_config('crm.workspace_id',tenant::text,true);
  perform set_config('role','crm_workspace_server',true);
  select count(*) into n from public.workspace_activity where workspace_id=tenant;
  if n < 2 then raise exception 'Admin cannot read activity'; end if;
  select count(*) into n from public.workspace_activity where workspace_id=other_tenant;
  if n <> 0 then raise exception 'Activity crossed workspace boundary'; end if;
  perform set_config('request.headers',jsonb_build_object('x-crm-user-id',other_actor)::text,true);
  select count(*) into n from public.workspace_activity;
  if n <> 0 then raise exception 'Non-admin can read activity'; end if;
  begin
    delete from public.workspace_activity where workspace_id=tenant;
    raise exception 'Activity deletion was allowed';
  exception when insufficient_privilege then null; end;
  perform set_config('role','postgres',true);
end $$;
rollback;
