-- All fixtures are rolled back. Run against the migrated database as postgres.
begin;
select set_config('portal_test.workspace_a', gen_random_uuid()::text, true);
select set_config('portal_test.workspace_b', gen_random_uuid()::text, true);
select set_config('portal_test.actor', (select id::text from auth.users order by created_at limit 1), true);
insert into public.workspaces(id,name,slug,owner_id) values
  (current_setting('portal_test.workspace_a')::uuid,'Portal domain QA A','portal-qa-'||current_setting('portal_test.workspace_a'),current_setting('portal_test.actor')::uuid),
  (current_setting('portal_test.workspace_b')::uuid,'Portal domain QA B','portal-qa-'||current_setting('portal_test.workspace_b'),current_setting('portal_test.actor')::uuid);
insert into public.workspace_members(workspace_id,user_id,role,activated_at) values
  (current_setting('portal_test.workspace_a')::uuid,current_setting('portal_test.actor')::uuid,'admin',now()),
  (current_setting('portal_test.workspace_b')::uuid,current_setting('portal_test.actor')::uuid,'admin',now())
on conflict (workspace_id,user_id) do update set role='admin',activated_at=now();
set local role crm_workspace_server;
select set_config('crm.workspace_id',current_setting('portal_test.workspace_a'),true);
select set_config('request.headers',jsonb_build_object('x-crm-workspace-id',current_setting('portal_test.workspace_a'),'x-crm-user-id',current_setting('portal_test.actor'))::text,true);
insert into public.workspace_portal_domains(hostname,verification_token) values ('portal-qa-a.example.com',repeat('a',48));
do $$ begin
  if (select count(*) from public.workspace_portal_domains) <> 1 then raise exception 'Workspace A cannot read its own domain'; end if;
end $$;
select set_config('crm.workspace_id',current_setting('portal_test.workspace_b'),true);
select set_config('request.headers',jsonb_build_object('x-crm-workspace-id',current_setting('portal_test.workspace_b'),'x-crm-user-id',current_setting('portal_test.actor'))::text,true);
do $$ begin
  if exists(select 1 from public.workspace_portal_domains) then raise exception 'Workspace A domain leaked to B'; end if;
  begin
    insert into public.workspace_portal_domains(hostname,verification_token) values ('portal-qa-a.example.com',repeat('b',48));
    raise exception 'Hostname uniqueness was not enforced';
  exception when unique_violation then null; end;
  begin
    insert into public.workspace_portal_domains(workspace_id,hostname,verification_token) values (current_setting('portal_test.workspace_a')::uuid,'portal-qa-forged.example.com',repeat('b',48));
    raise exception 'Forged workspace insert was permitted';
  exception when insufficient_privilege then null; end;
end $$;
insert into public.workspace_portal_domains(hostname,verification_token) values ('portal-qa-b.example.com',repeat('b',48));
select set_config('request.headers',jsonb_build_object('x-crm-workspace-id',current_setting('portal_test.workspace_b'),'x-crm-user-id',gen_random_uuid())::text,true);
do $$ begin
  update public.workspace_portal_domains set message='unauthorized edit';
  if found then raise exception 'Non-admin update was permitted'; end if;
  if has_table_privilege('anon','public.workspace_portal_domains','select') or has_table_privilege('authenticated','public.workspace_portal_domains','select') then raise exception 'Browser role can read domain settings'; end if;
end $$;
reset role;
rollback;
select 'Portal domain RLS, admin-only mutations and unique hostnames verified; fixtures rolled back.' as result;
