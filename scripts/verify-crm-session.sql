-- Run after the consolidated_crm_session migration. Fixtures are never committed.
begin;
do $$
declare
  first_user uuid := gen_random_uuid();
  other_user uuid := gen_random_uuid();
  live_session uuid := gen_random_uuid();
  other_session uuid := gen_random_uuid();
  matches integer;
  snapshot record;
begin
  if has_function_privilege('anon', 'public.read_crm_session(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.read_crm_session(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'crm_auth_private.read_crm_session(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'crm_auth_private.read_crm_session(uuid,uuid)', 'execute')
     or has_schema_privilege('authenticated', 'crm_auth_private', 'usage')
     or not has_function_privilege('service_role', 'public.read_crm_session(uuid,uuid)', 'execute') then
    raise exception 'Unexpected session-reader privileges';
  end if;
  insert into auth.users(id,email,raw_user_meta_data)
    values (first_user, first_user::text || '@example.invalid', '{"avatar_preset":"female","role":"admin","private_unrelated":"hidden"}'),
           (other_user, other_user::text || '@example.invalid', '{}');
  insert into auth.sessions(id,user_id,created_at,updated_at)
    values (live_session,first_user,now(),now()), (other_session,other_user,now(),now());
  insert into public.workspace_members(user_id,role,display_name,activated_at)
    values (first_user,'operator','Session fixture',now());
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  -- Exercise the wrapper with the actual database service-role permissions.
  execute 'set local role service_role';
  select * into snapshot from public.read_crm_session(first_user,live_session);
  if snapshot.id is distinct from first_user or snapshot.role is distinct from 'operator'
     or snapshot.user_metadata->>'avatar_preset' is distinct from 'female'
     or snapshot.user_metadata ? 'private_unrelated' or snapshot.user_metadata ? 'role' then
    raise exception 'Unexpected valid session snapshot';
  end if;
  select count(*) into matches from public.read_crm_session(first_user,other_session);
  if matches <> 0 then raise exception 'Other user session accepted'; end if;
  select count(*) into matches from public.read_crm_session(first_user,gen_random_uuid());
  if matches <> 0 then raise exception 'Missing session accepted'; end if;
  reset role;

  update public.workspace_members set role='viewer' where user_id=first_user;
  select * into snapshot from public.read_crm_session(first_user,live_session);
  if snapshot.role is distinct from 'viewer' then raise exception 'Role change stale'; end if;
  update public.workspace_members set activated_at=null where user_id=first_user;
  select * into snapshot from public.read_crm_session(first_user,live_session);
  if snapshot.activated_at is not null then raise exception 'Inactive membership accepted'; end if;
  delete from public.workspace_members where user_id=first_user;
  select * into snapshot from public.read_crm_session(first_user,live_session);
  if snapshot.id is distinct from first_user or snapshot.role is not null then raise exception 'Missing membership misrepresented'; end if;

  update auth.users set banned_until=now()+interval '1 hour' where id=first_user;
  select count(*) into matches from public.read_crm_session(first_user,live_session);
  if matches <> 0 then raise exception 'Banned user accepted'; end if;
  update auth.users set banned_until=null,deleted_at=now() where id=first_user;
  select count(*) into matches from public.read_crm_session(first_user,live_session);
  if matches <> 0 then raise exception 'Deleted user accepted'; end if;
  update auth.users set deleted_at=null where id=first_user;
  update auth.sessions set not_after=now()-interval '1 minute' where id=live_session;
  select count(*) into matches from public.read_crm_session(first_user,live_session);
  if matches <> 0 then raise exception 'Expired session accepted'; end if;
  delete from auth.sessions where id=live_session;
  select count(*) into matches from public.read_crm_session(first_user,live_session);
  if matches <> 0 then raise exception 'Revoked session accepted'; end if;
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  select count(*) into matches from public.read_crm_session(other_user,other_session);
  if matches <> 0 then raise exception 'Non-service caller accepted'; end if;
end;
$$;
select 'All session safety assertions passed; fixture transaction rolled back' as result;
rollback;
