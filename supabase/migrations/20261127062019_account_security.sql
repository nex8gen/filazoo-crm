begin;

-- Auth tables stay private. These service-only functions accept IDs exclusively
-- from a signature-verified token in the application, never from form inputs.
create or replace function crm_auth_private.read_account_security(p_user_id uuid, p_session_id uuid)
returns table(id uuid, mfa_required boolean)
language sql stable security definer set search_path = '' as $$
  select u.id, exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.status='verified' and f.factor_type <> 'recovery_code')
  from auth.users u join auth.sessions s on s.user_id=u.id and s.id=p_session_id
  where u.id=p_user_id and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=now())
    and (s.not_after is null or s.not_after>now());
$$;
revoke all on function crm_auth_private.read_account_security(uuid,uuid) from public,anon,authenticated;
grant execute on function crm_auth_private.read_account_security(uuid,uuid) to service_role;

create or replace function public.read_account_security(p_user_id uuid, p_session_id uuid)
returns table(id uuid, mfa_required boolean)
language sql stable security invoker set search_path = '' as $$
  select * from crm_auth_private.read_account_security(p_user_id,p_session_id);
$$;
revoke all on function public.read_account_security(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_account_security(uuid,uuid) to service_role;

create or replace function public.read_secure_workspace_session(p_user_id uuid,p_session_id uuid,p_workspace_id uuid default null)
returns table(id uuid,email text,user_metadata jsonb,role text,display_name text,activated_at timestamptz,workspace_id uuid,workspace_name text,owner_id uuid,subscription_active boolean,mfa_required boolean)
language sql stable security invoker set search_path = '' as $$
  select w.*, a.mfa_required from public.read_subscribed_workspace_session(p_user_id,p_session_id,p_workspace_id) w
  join crm_auth_private.read_account_security(p_user_id,p_session_id) a on a.id=w.id;
$$;
revoke all on function public.read_secure_workspace_session(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_secure_workspace_session(uuid,uuid,uuid) to service_role;

create or replace function crm_auth_private.list_account_sessions(p_user_id uuid,p_session_id uuid)
returns table(id uuid,user_agent text,ip text,created_at timestamptz,last_active_at timestamptz,current boolean)
language sql stable security definer set search_path = '' as $$
  select s.id,s.user_agent,host(s.ip),s.created_at,
    coalesce(s.refreshed_at at time zone 'UTC',s.updated_at,s.created_at),s.id=p_session_id
  from auth.sessions s
  join crm_auth_private.read_account_security(p_user_id,p_session_id) a on a.id=s.user_id
  join auth.sessions caller on caller.id=p_session_id and caller.user_id=a.id
  where (s.not_after is null or s.not_after>now())
    and (not a.mfa_required or caller.aal='aal2')
  order by (s.id=p_session_id) desc,s.created_at desc;
$$;
revoke all on function crm_auth_private.list_account_sessions(uuid,uuid) from public,anon,authenticated;
grant execute on function crm_auth_private.list_account_sessions(uuid,uuid) to service_role;

create or replace function public.list_account_sessions(p_user_id uuid,p_session_id uuid)
returns table(id uuid,user_agent text,ip text,created_at timestamptz,last_active_at timestamptz,current boolean)
language sql stable security invoker set search_path = '' as $$
  select * from crm_auth_private.list_account_sessions(p_user_id,p_session_id);
$$;
revoke all on function public.list_account_sessions(uuid,uuid) from public,anon,authenticated;
grant execute on function public.list_account_sessions(uuid,uuid) to service_role;

create or replace function crm_auth_private.revoke_account_sessions(p_user_id uuid,p_session_id uuid,p_scope text,p_target_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  if p_scope not in ('one','others','all') or p_scope is null then raise exception 'Invalid session scope'; end if;
  -- Lock the caller to keep authorization valid throughout the deletion.
  perform 1 from auth.sessions s join crm_auth_private.read_account_security(p_user_id,p_session_id) a on a.id=s.user_id
    where s.id=p_session_id and (not a.mfa_required or s.aal='aal2') for update of s;
  if not found then raise insufficient_privilege using message='An active verified session is required'; end if;
  if p_scope='one' and not exists(select 1 from auth.sessions where id=p_target_id and user_id=p_user_id) then
    raise insufficient_privilege using message='Session not found';
  end if;
  -- Deleting the Auth session also invalidates its refresh tokens. CRM readers
  -- check session existence on every request, including still-unexpired JWTs.
  delete from auth.sessions s where s.user_id=p_user_id
    and (p_scope='all' or (p_scope='others' and s.id<>p_session_id) or (p_scope='one' and s.id=p_target_id));
  get diagnostics removed = row_count;
  return removed;
end $$;
revoke all on function crm_auth_private.revoke_account_sessions(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function crm_auth_private.revoke_account_sessions(uuid,uuid,text,uuid) to service_role;

create or replace function public.revoke_account_sessions(p_user_id uuid,p_session_id uuid,p_scope text,p_target_id uuid default null)
returns integer language sql security invoker set search_path = '' as $$
  select crm_auth_private.revoke_account_sessions(p_user_id,p_session_id,p_scope,p_target_id);
$$;
revoke all on function public.revoke_account_sessions(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.revoke_account_sessions(uuid,uuid,text,uuid) to service_role;

notify pgrst,'reload schema';
commit;
