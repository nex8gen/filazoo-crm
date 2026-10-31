-- Run as the service/migration role. Every fixture and policy change is rolled back.
begin;
do $$
declare
  root text := 'conversation:message:tagging-qa@example.test';
  alias text := 'conversation:tagging-qa';
  legacy text := 'imap-tagging-qa@example.test';
  first_token uuid := gen_random_uuid();
  next_token uuid := gen_random_uuid();
  latest timestamptz := now() - interval '1 hour';
  buyer_email text := 'qa-tag-' || gen_random_uuid()::text || '@example.test';
  company uuid := gen_random_uuid();
  actual text;
begin
  insert into public.companies(id,name,source,status) values(company,'Conversation tag database QA','qa','new');
  insert into public.contacts(company_id,name,email) values(company,'QA buyer',buyer_email);
  if has_table_privilege('anon', 'public.crm_conversation_tag_analysis', 'SELECT')
    or has_table_privilege('authenticated', 'public.crm_conversation_tag_analysis', 'SELECT')
    or has_function_privilege('anon', 'public.claim_conversation_tag_analysis(text,text,timestamptz,integer,uuid)', 'EXECUTE') then
    raise exception 'Background AI state must be server-only';
  end if;
  update public.workspace_ai_settings set policy = jsonb_set(policy, '{actions,tagging}', '"auto"') where singleton;
  if not public.claim_conversation_tag_analysis(root, 'first', latest, 1, first_token) then raise exception 'Initial claim failed'; end if;
  if public.claim_conversation_tag_analysis(root, 'first', latest, 1, next_token) then raise exception 'Concurrent claim stole ownership'; end if;
  if not public.finish_conversation_tag_analysis(root, first_token, array[root,alias], array[legacy], buyer_email,
    'New Inquiries', .97, 'Customer requested a quote', '[{"messageKey":"imap-tagging-qa@example.test","quote":"Please quote 100 kg"}]') then raise exception 'Finish failed'; end if;
  select tag into actual from public.crm_email_tags where message_key=alias;
  if actual <> 'New Inquiries' then raise exception 'Shared aliases were not updated'; end if;
  if exists(select 1 from public.crm_email_tags where message_key=legacy and tag is not null) then raise exception 'Legacy message tag must be cleared'; end if;
  if public.claim_conversation_tag_analysis(root, 'first', latest, 1, next_token) then raise exception 'Unchanged input was reanalyzed'; end if;

  if public.claim_conversation_tag_analysis(root, 'reply', latest + interval '1 minute', 2, next_token) then raise exception 'Rapid reply bypassed cooldown'; end if;
  update public.crm_conversation_tag_analysis set checked_at=now()-interval '2 minutes' where conversation_key=root;
  if not public.claim_conversation_tag_analysis(root, 'reply', latest + interval '1 minute', 2, next_token) then raise exception 'New reply did not invalidate cache'; end if;
  -- A manual update to any conversation alias wins over the in-flight model result.
  update public.crm_email_tags set tag='Postponed Purchasing', source='manual', updated_at=clock_timestamp() where message_key=alias;
  perform public.finish_conversation_tag_analysis(root, next_token, array[root,alias], array[legacy], buyer_email,
    'Payment Follow-up', .98, 'Stale proposed payment tag', '[]');
  select tag into actual from public.crm_email_tags where message_key=alias;
  if actual <> 'Postponed Purchasing' then raise exception 'Manual edit was overwritten'; end if;
  if not exists(select 1 from public.crm_conversation_tag_analysis where conversation_key=root and status='manual') then raise exception 'Override was not recorded'; end if;

  -- A manual decision made before the next reply does not permanently freeze automation.
  update public.crm_email_tags set updated_at=now()-interval '2 hours' where message_key=alias;
  update public.crm_conversation_tag_analysis set checked_at=now()-interval '2 minutes' where conversation_key=root;
  if not public.claim_conversation_tag_analysis(root, 'later-reply', now()-interval '1 minute', 3, first_token) then raise exception 'Next activity did not resume automation'; end if;
  update public.crm_conversation_tag_analysis set lease_until=now()-interval '1 second', checked_at=now()-interval '2 minutes' where conversation_key=root;
  if not public.claim_conversation_tag_analysis(root, 'newest-reply', now(), 4, next_token) then raise exception 'Expired ownership was not recovered'; end if;
  if public.finish_conversation_tag_analysis(root, first_token, array[root,alias], array[legacy], buyer_email, 'Payment Follow-up', .99, 'Expired worker', '[]') then raise exception 'Expired worker committed'; end if;
  if public.claim_conversation_tag_analysis(root, 'older-snapshot', latest, 1, first_token) then raise exception 'Older partial mailbox copy replaced newer analysis'; end if;
  -- Revoking access during the provider request prevents the result being committed.
  update public.workspace_ai_settings set policy=jsonb_set(policy,'{actions,tagging}','"deny"') where singleton;
  perform public.finish_conversation_tag_analysis(root, next_token, array[root,alias], array[legacy], buyer_email, 'Orders in Fulfillment', .99, 'Order started', '[]');
  select tag into actual from public.crm_email_tags where message_key=alias;
  if actual <> 'Postponed Purchasing' then raise exception 'Revoked AI permission was ignored'; end if;
  if not exists(select 1 from public.crm_conversation_tag_analysis where conversation_key=root and status='failed' and retry_at > now()) then raise exception 'Recovery backoff missing'; end if;
end $$;
rollback;
