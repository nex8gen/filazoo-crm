-- Run in a transaction/savepoint and always roll back. No email is sent.
do $$
declare item record; invite record; actor uuid; colleague uuid; outsider uuid:=gen_random_uuid(); w uuid; o jsonb; capacity jsonb;
 invitation_id uuid; replacement uuid; token text; old_token text; email text; denied boolean; i integer; first_member uuid;
begin
 if has_function_privilege('authenticated','public.create_workspace_team_invitation(uuid,uuid,text,text,text,text)','execute')
  or has_function_privilege('anon','public.read_workspace_team_capacity(uuid,uuid)','execute')
  or has_function_privilege('crm_workspace_server','public.create_workspace_team_invitation(uuid,uuid,text,text,text,text)','execute')
 then raise exception 'FAIL: invitation provisioning exposed to browser/tenant role'; end if;
 insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(outsider,outsider||'@team-quota.invalid',now(),'{}');
 for item in select * from (values ('starter',1,13900),('pro',2,42900),('business',5,92900)) p(plan,seats,price) loop
  actor:=gen_random_uuid();
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(actor,actor||'@team-quota.invalid',now(),'{}');
  o:=public.create_current_package_subscription_order(actor,null,'Team limits test',item.plan,item.seats,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),1);
  w:=(o->>'workspace_id')::uuid;
  perform public.confirm_subscription_payment(o->>'out_trade_no',(202611280000000100::bigint+item.seats)::text,item.price,'TRADE_SUCCESS');
  capacity:=public.read_workspace_team_capacity(actor,w);
  if (capacity->>'memberCount')::integer<>1 or (capacity->>'memberLimit')::integer<>item.seats
   or (capacity->>'canInvite')::boolean<>(item.seats>1) then raise exception 'FAIL: initial capacity %',capacity; end if;
  denied:=false;
  begin perform public.read_workspace_team_capacity(outsider,w); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'FAIL: other workspace capacity exposed'; end if;
  denied:=false;
  begin perform public.create_workspace_team_invitation(outsider,w,'other@team-quota.invalid','Other user','admin',repeat('a',64)); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'FAIL: other user invited into workspace'; end if;
  denied:=false;
  begin perform public.create_workspace_team_invitation(actor,w,actor||'@team-quota.invalid','Owner again','viewer',repeat('a',64)); exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'FAIL: existing owner invited again'; end if;
  if item.seats=1 then
   foreach token in array array['admin','operator','bd_manager','viewer'] loop
    denied:=false;
    begin perform public.create_workspace_team_invitation(actor,w,'starter-'||token||'@team-quota.invalid','Extra user',token,encode(extensions.gen_random_bytes(32),'hex')); exception when raise_exception then denied:=sqlerrm like '%no available user places%'; end;
    if not denied then raise exception 'FAIL: Starter created % invitation',token; end if;
   end loop;
   denied:=false;
   begin insert into public.workspace_invitations(workspace_id,email,display_name,role,token_hash,invited_by)
    values(w,'direct@team-quota.invalid','Direct invite','viewer',repeat('b',64),actor); exception when raise_exception then denied:=true; end;
   if not denied then raise exception 'FAIL: direct invitation bypass'; end if;
   denied:=false;
   begin insert into public.workspace_members(workspace_id,user_id,role,activated_at) values(w,outsider,'viewer',now()); exception when raise_exception then denied:=true; end;
   if not denied then raise exception 'FAIL: direct Starter membership bypass'; end if;
   continue;
  end if;
  for i in 2..item.seats loop
   colleague:=gen_random_uuid(); email:=colleague||'@team-quota.invalid';
   if i=2 then first_member:=colleague; end if;
   insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(colleague,email,now(),'{}');
   token:=encode(extensions.gen_random_bytes(32),'hex');
   invitation_id:=public.create_workspace_team_invitation(actor,w,email,'Teammate '||i,case i when 2 then 'viewer' when 3 then 'operator' when 4 then 'bd_manager' else 'admin' end,token);
  end loop;
  capacity:=public.read_workspace_team_capacity(actor,w);
  if (capacity->>'pendingCount')::integer<>item.seats-1 or (capacity->>'canInvite')::boolean then raise exception 'FAIL: pending invitations did not reserve seats'; end if;
  denied:=false;
  begin perform public.create_workspace_team_invitation(actor,w,'over@team-quota.invalid','Too many','viewer',encode(extensions.gen_random_bytes(32),'hex')); exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'FAIL: unlimited pending invitations'; end if;
  denied:=false;
  begin insert into public.workspace_members(workspace_id,user_id,role,activated_at) values(w,outsider,'viewer',now()); exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'FAIL: direct member stole a reserved seat'; end if;
  old_token:=token; token:=encode(extensions.gen_random_bytes(32),'hex');
  replacement:=public.create_workspace_team_invitation(actor,w,email,'Reissued teammate','viewer',token);
  if not exists(select 1 from public.workspace_invitations where id=invitation_id and revoked_at is not null)
   or public.read_workspace_team_capacity(actor,w)->>'pendingCount'<>(item.seats-1)::text then raise exception 'FAIL: resend at capacity'; end if;
  denied:=false;
  begin perform public.accept_workspace_invitation(colleague,old_token); exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'FAIL: old link accepted after resend'; end if;
  denied:=false;
  begin perform public.accept_workspace_invitation(outsider,token); exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'FAIL: wrong email accepted invitation'; end if;
  if item.plan='pro' then
   update public.subscription_orders set period_start=now()-interval '2 months',period_end=now()-interval '1 month' where id=(o->>'id')::uuid;
   denied:=false;
   begin perform public.create_workspace_team_invitation(actor,w,email,'Failed replacement','viewer',encode(extensions.gen_random_bytes(32),'hex')); exception when raise_exception then denied:=sqlerrm like '%active subscription%'; end;
   if not denied or (select revoked_at from public.workspace_invitations where id=replacement) is not null then raise exception 'FAIL: failed resend revoked original'; end if;
   denied:=false;
   begin perform public.accept_workspace_invitation(colleague,token); exception when raise_exception then denied:=sqlerrm like '%active subscription%'; end;
   if not denied or (select accepted_at from public.workspace_invitations where id=replacement) is not null then raise exception 'FAIL: expired plan accepted invitation'; end if;
   denied:=false;
   begin perform public.create_current_package_subscription_order(actor,w,'Too small','starter',1,'subscription','FZ'||replace(gen_random_uuid()::text,'-',''),1); exception when raise_exception then denied:=sqlerrm like '%current team%'; end;
   if not denied then raise exception 'FAIL: checkout ignored pending user places'; end if;
   update public.subscription_orders set period_start=now()-interval '1 minute',period_end=now()+interval '1 month' where id=(o->>'id')::uuid;
  end if;
  update public.workspace_invitations set expires_at=now()-interval '1 second' where id=replacement;
  if not (public.read_workspace_team_capacity(actor,w)->>'canInvite')::boolean then raise exception 'FAIL: expired invitation retained seat'; end if;
  token:=encode(extensions.gen_random_bytes(32),'hex');
  replacement:=public.create_workspace_team_invitation(actor,w,email,'Available again','viewer',token);
  update public.workspace_invitations set revoked_at=now() where id=replacement;
  if not (public.read_workspace_team_capacity(actor,w)->>'canInvite')::boolean then raise exception 'FAIL: revoked invitation retained seat'; end if;
  denied:=false;
  begin perform public.create_workspace_team_invitation(actor,w,email,'Invalid hash','viewer',token||'aa'); exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'FAIL: invalid token hash accepted'; end if;
  token:=encode(extensions.gen_random_bytes(32),'hex');
  replacement:=public.create_workspace_team_invitation(actor,w,email,'Available again','viewer',token);
  for invite in select i.token_hash,u.id from public.workspace_invitations i join auth.users u on u.email::text=i.email
   where i.workspace_id=w and i.revoked_at is null and i.accepted_at is null and i.expires_at>now() loop
   perform set_config('role','service_role',true);
   if public.accept_workspace_invitation(invite.id,invite.token_hash)<>w then raise exception 'FAIL: joined incorrect workspace'; end if;
   perform set_config('role','postgres',true);
  end loop;
  capacity:=public.read_workspace_team_capacity(actor,w);
  if (capacity->>'memberCount')::integer<>item.seats or capacity->>'pendingCount'<>'0' or (capacity->>'canInvite')::boolean then raise exception 'FAIL: accepted invitations double-counted/missing members %',capacity; end if;
  denied:=false;
  begin perform public.read_workspace_team_capacity(first_member,w); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'FAIL: viewer can read administrator capacity'; end if;
  denied:=false;
  begin perform public.create_workspace_team_invitation(first_member,w,'forged@team-quota.invalid','Forged invitation','admin',encode(extensions.gen_random_bytes(32),'hex')); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'FAIL: viewer can invite administrators'; end if;
  denied:=false;
  begin perform public.create_workspace_team_invitation(actor,w,'full@team-quota.invalid','Full team','viewer',encode(extensions.gen_random_bytes(32),'hex')); exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'FAIL: full team created invitation'; end if;
  delete from public.workspace_members where workspace_id=w and user_id=first_member;
  if not (public.read_workspace_team_capacity(actor,w)->>'canInvite')::boolean then raise exception 'FAIL: removing member did not free seat'; end if;
  -- Multi-row inserts cannot reserve two copies of the last available place.
  denied:=false;
  begin
   insert into public.workspace_invitations(workspace_id,email,display_name,role,token_hash,invited_by) values
    (w,'bulk-1@team-quota.invalid','Bulk one','viewer',encode(extensions.gen_random_bytes(32),'hex'),actor),
    (w,'bulk-2@team-quota.invalid','Bulk two','viewer',encode(extensions.gen_random_bytes(32),'hex'),actor);
  exception when raise_exception then denied:=true; end;
  if not denied or public.read_workspace_team_capacity(actor,w)->>'pendingCount'<>'0' then raise exception 'FAIL: bulk invitation exceeded quota/partially committed'; end if;
 end loop;
end $$;
select 'Starter/Pro/Business team limits, pending reservations, atomic resends, expiry, acceptance, permissions and bulk writes passed' as result;
