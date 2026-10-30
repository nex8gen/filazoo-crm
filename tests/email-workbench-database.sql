begin;
do $$
declare actor uuid; mailbox uuid; draft_id text := 'audit-' || gen_random_uuid()::text; result boolean;
begin
  select user_id into actor from public.workspace_members where activated_at is not null limit 1;
  select id into mailbox from public.workspace_mailboxes where type='workspace' limit 1;
  if actor is null or mailbox is null then raise exception 'A test actor and mailbox are required'; end if;
  result := public.save_email_workbench_draft(actor,draft_id,mailbox,10,'{"text":"first"}');
  if not result then raise exception 'Initial draft was not saved'; end if;
  result := public.save_email_workbench_draft(actor,draft_id,mailbox,12,'{"text":"newest"}');
  if not result then raise exception 'Newer draft was not saved'; end if;
  result := public.save_email_workbench_draft(actor,draft_id,mailbox,11,'{"text":"stale"}');
  if result then raise exception 'Stale draft overwrote a newer draft'; end if;
  if (select payload->>'text' from public.email_workbench_drafts where user_id=actor and id=draft_id) <> 'newest' then raise exception 'Draft body changed'; end if;
  result := public.save_email_workbench_draft(actor,draft_id,mailbox,12,'{"text":"newest"}');
  if not result then raise exception 'An identical retry must be idempotent'; end if;
  perform public.save_email_workbench_draft(actor,draft_id,mailbox,13,'{}',true);
  result := public.save_email_workbench_draft(actor,draft_id,mailbox,14,'{"text":"resurrected"}');
  if result then raise exception 'A late autosave resurrected a deleted draft'; end if;
  if has_table_privilege('authenticated','public.email_workbench_drafts','SELECT') or has_table_privilege('anon','public.email_send_operations','SELECT') then raise exception 'Drafts or delivery records exposed to browser roles'; end if;
  if has_function_privilege('authenticated','public.save_email_workbench_draft(uuid,text,uuid,bigint,jsonb,boolean)','EXECUTE') then raise exception 'Draft RPC exposed to browser roles'; end if;
end $$;
rollback;
