-- The application verifies the JWT signature/expiry with Supabase getClaims()
-- before passing its subject/session IDs here using the server-only service key.
-- No caller-supplied metadata or role is accepted. This replaces two sequential
-- Auth + membership HTTP calls with one fresh, uncached database snapshot.
begin;

create schema if not exists crm_auth_private;
revoke all on schema crm_auth_private from public, anon, authenticated;
grant usage on schema crm_auth_private to service_role;

create or replace function crm_auth_private.read_crm_session(p_user_id uuid, p_session_id uuid)
returns table (
  id uuid,
  email text,
  user_metadata jsonb,
  role text,
  display_name text,
  activated_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select u.id, u.email::text,
    jsonb_build_object(
      'avatar_path', u.raw_user_meta_data->'avatar_path',
      'avatar_preset', u.raw_user_meta_data->'avatar_preset',
      'crm_preferences', u.raw_user_meta_data->'crm_preferences'
    ), m.role, m.display_name, m.activated_at
  from auth.users u
  join auth.sessions s on s.user_id = u.id and s.id = p_session_id
  left join public.workspace_members m on m.user_id = u.id
  where auth.role() = 'service_role'
    and u.id = p_user_id
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
    and (s.not_after is null or s.not_after > now());
$$;

revoke all on function crm_auth_private.read_crm_session(uuid, uuid) from public, anon, authenticated;
grant execute on function crm_auth_private.read_crm_session(uuid, uuid) to service_role;

-- The exposed wrapper has no elevated privileges. Only the existing server
-- service role can invoke the private, narrowly scoped Auth-table reader.
create or replace function public.read_crm_session(p_user_id uuid, p_session_id uuid)
returns table (
  id uuid,
  email text,
  user_metadata jsonb,
  role text,
  display_name text,
  activated_at timestamptz
)
language sql stable security invoker
set search_path = ''
as $$
  select * from crm_auth_private.read_crm_session(p_user_id, p_session_id);
$$;

revoke all on function public.read_crm_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_crm_session(uuid, uuid) to service_role;
comment on function public.read_crm_session(uuid, uuid) is
  'Server-only current session, account, profile and membership snapshot; call only with IDs from a verified Supabase JWT.';

commit;
