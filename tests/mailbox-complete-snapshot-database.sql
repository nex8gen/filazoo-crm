-- Disposable records only; all data and configuration changes are rolled back.
begin;
do $$
declare
  fixture text := 'complete-snapshot-' || gen_random_uuid()::text;
  box uuid;
  tenant uuid;
  owner_token uuid := gen_random_uuid();
  snapshot_token uuid := gen_random_uuid();
  payload jsonb;
  saved jsonb;
begin
  select id, workspace_id into box, tenant from public.workspace_mailboxes limit 1;
  if box is null then raise exception 'A mailbox fixture is required'; end if;
  insert into public.mail_sync_accounts(workspace_id,account_key,mailbox_id,lease_token,lease_until)
  values(tenant,fixture,box,owner_token,now()+interval '5 minutes');
  select jsonb_agg(jsonb_build_object('id',n::text,'preview',repeat('x',200)) order by n desc)
  into payload from generate_series(1,5000) n;
  insert into public.mailbox_sync_state(workspace_id,mailbox_key,uid_validity,last_uid,messages,lease_token)
  values(tenant,fixture,1,5000,payload,snapshot_token);

  -- Neither a stale account owner nor a stale snapshot owner can commit.
  if public.commit_mail_sync_snapshot(fixture,gen_random_uuid(),fixture,snapshot_token,
      jsonb_build_object('uid_validity',1,'last_uid',5001,'messages',payload)) then
    raise exception 'Stale account owner committed';
  end if;
  if public.commit_mail_sync_snapshot(fixture,owner_token,fixture,gen_random_uuid(),
      jsonb_build_object('uid_validity',1,'last_uid',5001,'messages',payload)) then
    raise exception 'Stale snapshot owner committed';
  end if;
  -- The complete app-merged snapshot already handles the bound and eviction.
  payload := jsonb_set(payload,'{0,preview}','"updated"');
  if not public.commit_mail_sync_snapshot(fixture,owner_token,fixture,snapshot_token,
      jsonb_build_object('uid_validity',1,'last_uid',5001,'messages',payload)) then
    raise exception 'Current worker could not commit';
  end if;
  select messages into saved from public.mailbox_sync_state where mailbox_key=fixture;
  if saved <> payload or jsonb_array_length(saved) <> 5000 then
    raise exception 'Complete snapshot was modified';
  end if;
  if current_setting('filazoo_mail.complete_snapshot',true) = 'on' then
    raise exception 'Complete snapshot scope leaked outside the RPC';
  end if;
  -- A legacy partial write must still preserve the saved history and precedence.
  update public.mailbox_sync_state set messages='[{"id":"new"},{"id":"5000","preview":"legacy"}]'
  where mailbox_key=fixture;
  select messages into saved from public.mailbox_sync_state where mailbox_key=fixture;
  if jsonb_array_length(saved) <> 5000 or saved->0->>'id' <> 'new'
     or saved->1->>'preview' <> 'legacy' then
    raise exception 'Legacy history protection was bypassed';
  end if;
  if has_function_privilege('authenticated','public.commit_mail_sync_snapshot(text,uuid,text,uuid,jsonb)','execute')
     or has_function_privilege('anon','public.commit_mail_sync_snapshot(text,uuid,text,uuid,jsonb)','execute') then
    raise exception 'Worker RPC exposed to browser roles';
  end if;
end $$;
select 'Complete snapshot, legacy preservation, and fencing passed' as result;
rollback;
