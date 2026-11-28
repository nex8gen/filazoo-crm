begin;
set local lock_timeout='5s';

-- A live invitation reserves an included user place. Expired/revoked links do not.
create function crm_billing.pending_team_invitations(w uuid, excluded_id uuid default null) returns bigint
language sql volatile security definer set search_path='' as $$
 select count(*) from public.workspace_invitations i
 where i.workspace_id=w and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()
 and i.id is distinct from excluded_id
 and not exists(select 1 from public.workspace_members m join auth.users u on u.id=m.user_id
  where m.workspace_id=w and lower(u.email::text)=lower(i.email));
$$;
revoke all on function crm_billing.pending_team_invitations(uuid,uuid) from public,anon,authenticated;
grant execute on function crm_billing.pending_team_invitations(uuid,uuid) to service_role;

create function public.read_workspace_team_capacity(p_actor_id uuid,p_workspace_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e jsonb; members bigint; pending bigint; capacity integer;
begin
 perform 1 from crm_tenancy.verified_user(p_actor_id);
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_actor_id
  and role='admin' and activated_at is not null) then raise insufficient_privilege using message='Administrator access required'; end if;
 e:=crm_billing.entitlement(p_workspace_id);
 capacity:=case when coalesce((e->>'grandfathered')::boolean,false) then null else greatest(1,coalesce((e->>'seats')::integer,1)) end;
 select count(*) into members from public.workspace_members where workspace_id=p_workspace_id;
 pending:=crm_billing.pending_team_invitations(p_workspace_id);
 return jsonb_build_object('plan',e->>'plan','active',coalesce((e->>'active')::boolean,false),'memberLimit',capacity,
  'memberCount',members,'pendingCount',pending,'canInvite',coalesce((e->>'active')::boolean,false) and (capacity is null or members+pending<capacity));
end $$;
revoke all on function public.read_workspace_team_capacity(uuid,uuid) from public,anon,authenticated,crm_workspace_server;
grant execute on function public.read_workspace_team_capacity(uuid,uuid) to service_role;

create function crm_billing.enforce_invitation_capacity() returns trigger
language plpgsql security definer set search_path='' as $$
declare e jsonb; capacity integer; members bigint;
begin
 -- Acceptance and revocation must remain possible when the plan is full/expired.
 if new.accepted_at is not null or new.revoked_at is not null or new.expires_at<=now() then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text,1));
 e:=crm_billing.entitlement(new.workspace_id);
 if not coalesce((e->>'active')::boolean,false) then raise exception 'An active subscription is required to invite team members'; end if;
 if exists(select 1 from public.workspace_members m join auth.users u on u.id=m.user_id
  where m.workspace_id=new.workspace_id and lower(u.email::text)=lower(new.email)) then
  raise exception 'This person is already a workspace member';
 end if;
 if coalesce((e->>'grandfathered')::boolean,false) then return new; end if;
 capacity:=greatest(1,coalesce((e->>'seats')::integer,1));
 select count(*) into members from public.workspace_members where workspace_id=new.workspace_id;
 if members+crm_billing.pending_team_invitations(new.workspace_id,new.id)>=capacity then
  raise exception 'Your plan has no available user places. Pending invitations also reserve a place';
 end if;
 return new;
end $$;
revoke all on function crm_billing.enforce_invitation_capacity() from public,anon,authenticated;
create trigger enforce_invitation_plan_limit before insert or update of workspace_id,email,accepted_at,revoked_at,expires_at
 on public.workspace_invitations for each row execute function crm_billing.enforce_invitation_capacity();

-- Creation and resend share one transaction. A failed replacement keeps the old link.
create function public.create_workspace_team_invitation(p_actor_id uuid,p_workspace_id uuid,p_email text,p_display_name text,p_role text,p_token_hash text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
 perform 1 from crm_tenancy.verified_user(p_actor_id);
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_actor_id
  and role='admin' and activated_at is not null) then raise insufficient_privilege using message='Administrator access required'; end if;
 if p_email is null or p_email<>lower(btrim(p_email)) or length(p_email)>320 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or p_display_name is null or length(btrim(p_display_name)) not between 2 and 80
  or p_role is null or p_role not in ('admin','operator','bd_manager','viewer')
  or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Enter a valid name, email, and workspace role'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,1));
 update public.workspace_invitations set revoked_at=now() where workspace_id=p_workspace_id and email=p_email and accepted_at is null and revoked_at is null;
 insert into public.workspace_invitations(workspace_id,email,display_name,role,invited_by,token_hash)
 values(p_workspace_id,p_email,btrim(p_display_name),p_role,p_actor_id,p_token_hash) returning id into result;
 return result;
end $$;
revoke all on function public.create_workspace_team_invitation(uuid,uuid,text,text,text,text) from public,anon,authenticated,crm_workspace_server;
grant execute on function public.create_workspace_team_invitation(uuid,uuid,text,text,text,text) to service_role;

-- Direct provisioning cannot consume places already reserved by other invitations.
create or replace function crm_billing.enforce_seats() returns trigger
language plpgsql security definer set search_path='' as $$
declare e jsonb; capacity integer; members bigint;
begin
 if tg_op='UPDATE' and new.workspace_id=old.workspace_id and (old.activated_at is not null or new.activated_at is null) then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text,1));
 if tg_op='INSERT' and exists(select 1 from public.workspace_members where workspace_id=new.workspace_id and user_id=new.user_id) then return new; end if;
 e:=crm_billing.entitlement(new.workspace_id);
 if coalesce((e->>'grandfathered')::boolean,false) then return new; end if;
 capacity:=greatest(1,coalesce((e->>'seats')::integer,1));
 select count(*) into members from public.workspace_members m where m.workspace_id=new.workspace_id
  and (tg_op<>'UPDATE' or (m.workspace_id,m.user_id) is distinct from (old.workspace_id,old.user_id));
 if members+crm_billing.pending_team_invitations(new.workspace_id)>=capacity then
  raise exception 'Your subscription member limit has been reached';
 end if;
 return new;
end $$;

-- Acquire the workspace lock before the invitation row, matching create/resend.
create or replace function public.accept_workspace_invitation(p_user_id uuid,p_token_hash text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare invitation public.workspace_invitations; verified_email text; w uuid;
begin
 select email into verified_email from crm_tenancy.verified_user(p_user_id);
 select workspace_id into w from public.workspace_invitations where token_hash=p_token_hash;
 if w is null then raise exception 'This invitation is invalid, expired, or belongs to another email'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text,1));
 select * into invitation from public.workspace_invitations where token_hash=p_token_hash for update;
 if invitation.id is null or invitation.revoked_at is not null or invitation.accepted_at is not null or invitation.expires_at<=now()
  or verified_email is distinct from invitation.email then raise exception 'This invitation is invalid, expired, or belongs to another email'; end if;
 if not crm_billing.has_access(w) then raise exception 'An active subscription is required to join this workspace'; end if;
 update public.workspace_invitations set accepted_at=now() where id=invitation.id;
 perform set_config('crm.workspace_id',w::text,true);
 perform set_config('role','crm_workspace_server',true);
 insert into public.workspace_members(workspace_id,user_id,role,display_name,activated_at,auto_assign_leads)
 values(w,p_user_id,invitation.role,invitation.display_name,now(),invitation.role='bd_manager')
 on conflict(workspace_id,user_id) do update set activated_at=excluded.activated_at
  where workspace_members.activated_at is null;
 return w;
end $$;

-- New checkout must accommodate reserved places as well as existing members.
do $$ declare source text; updated text; begin
 select pg_get_functiondef('public.create_current_package_subscription_order(uuid,uuid,text,text,integer,text,text,integer)'::regprocedure) into source;
 updated:=replace(source,'(select count(*) from public.workspace_members where workspace_id=w)>p_seats',
  '(select count(*) from public.workspace_members where workspace_id=w)+crm_billing.pending_team_invitations(w)>p_seats');
 if updated=source then raise exception 'Review package checkout team check before rollout'; end if;
 execute updated;
end $$;
notify pgrst,'reload schema';
commit;
