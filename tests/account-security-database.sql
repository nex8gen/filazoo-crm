begin;

insert into auth.users(id,email,raw_user_meta_data) values
 ('fd000001-1111-4111-8111-000000000001','security-a@example.invalid','{}'),
 ('fd000001-1111-4111-8111-000000000002','security-b@example.invalid','{}');
insert into auth.sessions(id,user_id,aal,user_agent,ip,created_at,updated_at) values
 ('fd000002-1111-4111-8111-000000000001','fd000001-1111-4111-8111-000000000001','aal1','Chrome on Windows','192.0.2.1',now(),now()),
 ('fd000002-1111-4111-8111-000000000002','fd000001-1111-4111-8111-000000000001','aal1','Safari on iPhone','192.0.2.2',now(),now()),
 ('fd000002-1111-4111-8111-000000000003','fd000001-1111-4111-8111-000000000002','aal1','Firefox','192.0.2.3',now(),now());

do $$
declare a uuid := 'fd000001-1111-4111-8111-000000000001'; b uuid := 'fd000001-1111-4111-8111-000000000002';
  s1 uuid := 'fd000002-1111-4111-8111-000000000001'; s2 uuid := 'fd000002-1111-4111-8111-000000000002'; s3 uuid := 'fd000002-1111-4111-8111-000000000003'; n integer;
begin
  if has_function_privilege('anon','public.read_account_security(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.read_secure_workspace_session(uuid,uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.list_account_sessions(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.revoke_account_sessions(uuid,uuid,text,uuid)','EXECUTE')
    or has_function_privilege('anon','crm_auth_private.revoke_account_sessions(uuid,uuid,text,uuid)','EXECUTE') then raise exception 'Auth RPC exposure'; end if;
  select count(*) into n from public.list_account_sessions(a,s1);
  if n<>2 then raise exception 'Session ownership leak or missing devices'; end if;
  if (select count(*) from public.list_account_sessions(a,s1) where current)<>1 then raise exception 'Current device incorrect'; end if;
  if exists(select 1 from public.list_account_sessions(a,s3)) or exists(select 1 from public.read_account_security(a,s3)) then raise exception 'Cross-user session accepted'; end if;
  begin
    perform public.revoke_account_sessions(a,s1,'one',s3);
    raise exception 'Cross-user revocation succeeded';
  exception when insufficient_privilege then null; end;
  if not exists(select 1 from auth.sessions where id=s3) then raise exception 'Other account session removed'; end if;

  insert into auth.mfa_factors(id,user_id,factor_type,status,friendly_name,created_at,updated_at)
    values('fd000003-1111-4111-8111-000000000001',a,'totp','verified','Test authenticator',now(),now());
  if not (select mfa_required from public.read_account_security(a,s1)) then raise exception 'Fresh MFA enrollment ignored'; end if;
  if exists(select 1 from public.list_account_sessions(a,s1)) then raise exception 'AAL1 can list devices after MFA enrollment'; end if;
  begin
    perform public.revoke_account_sessions(a,s1,'others');
    raise exception 'AAL1 can revoke verified account sessions';
  exception when insufficient_privilege then null; end;
  update auth.sessions set aal='aal2' where id=s1;
  if (select count(*) from public.list_account_sessions(a,s1))<>2 then raise exception 'Verified session cannot manage devices'; end if;

  update auth.sessions set not_after=now()-interval '1 second' where id=s2;
  if exists(select 1 from public.read_account_security(a,s2)) then raise exception 'Expired session accepted'; end if;
  if (select count(*) from public.list_account_sessions(a,s1))<>1 then raise exception 'Expired device still listed'; end if;
  update auth.sessions set not_after=null where id=s2;
  n:=public.revoke_account_sessions(a,s1,'others');
  if n<>1 or exists(select 1 from public.read_account_security(a,s2)) then raise exception 'Other-session revocation ineffective'; end if;
  if not exists(select 1 from auth.sessions where id=s1) or not exists(select 1 from auth.sessions where id=s3) then raise exception 'Wrong sessions revoked'; end if;
  begin
    perform public.revoke_account_sessions(a,s2,'all');
    raise exception 'Revoked caller still authorized';
  exception when insufficient_privilege then null; end;
  update auth.users set banned_until=now()+interval '1 hour' where id=a;
  if exists(select 1 from public.read_account_security(a,s1)) then raise exception 'Banned account accepted'; end if;
  update auth.users set banned_until=null where id=a;
  n:=public.revoke_account_sessions(a,s1,'all');
  if n<>1 or exists(select 1 from auth.sessions where user_id=a) then raise exception 'End all sessions failed'; end if;
  if not exists(select 1 from auth.sessions where id=s3) then raise exception 'End all crossed accounts'; end if;
end $$;

rollback;
