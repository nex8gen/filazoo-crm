-- All synthetic conversations, messages, proposals and usage records roll back.
begin;
do $$
declare
  actor uuid; stranger uuid := gen_random_uuid();
  chat uuid := gen_random_uuid(); test_action uuid := gen_random_uuid();
  test_request uuid := gen_random_uuid(); failed_request uuid := gen_random_uuid();
  replay jsonb; totals jsonb; response jsonb; table_name text;
begin
  select user_id into actor from public.workspace_members where activated_at is not null limit 1;
  if actor is null then raise exception 'An active workspace member is required'; end if;
  insert into public.ai_conversations(id,user_id,owner_role,access_key,mode,pathname,scope)
    values(chat,actor,'admin','test-access','agent','/companies','test-scope');
  insert into public.workspace_agent_actions(id,user_id,action,approval_mode) values(test_action,actor,'{"type":"test"}','ask');

  begin
    perform public.begin_ai_chat_turn(stranger,chat,test_request,0);
    raise exception 'FAIL: another user claimed a conversation';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform public.begin_ai_chat_turn(actor,chat,test_request,0);
  begin
    perform public.begin_ai_chat_turn(actor,chat,gen_random_uuid(),0);
    raise exception 'FAIL: concurrent request bypassed conversation lock';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;

  -- An invalid test_action rolls back the entire transcript completion.
  begin
    perform public.finish_ai_chat_turn(actor,chat,test_request,'{"content":"bad test_action"}',jsonb_build_object('output','test','actions',jsonb_build_array(jsonb_build_object('id',gen_random_uuid()))),'');
    raise exception 'FAIL: arbitrary test_action ID was linked';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  if exists(select 1 from public.ai_chat_messages where conversation_id=chat) then raise exception 'Partial transcript survived failed completion'; end if;

  response := jsonb_build_object('output','Synthetic remembered answer','actions',jsonb_build_array(jsonb_build_object('id',test_action)),'history',jsonb_build_object('conversationId',chat,'version',1));
  perform public.finish_ai_chat_turn(actor,chat,test_request,'{"content":"Synthetic question about filaments","attachmentNames":["sample.png"]}',response,'Earlier user excerpt');
  perform public.finish_ai_chat_turn(actor,chat,test_request,'{"content":"must not replace"}',response,'must not replace');
  if (select count(*) from public.ai_chat_messages where conversation_id=chat) <> 2 then raise exception 'Repeated completion duplicated messages'; end if;
  if not exists(select 1 from public.workspace_agent_actions where id=test_action and conversation_id=chat and status='pending') then raise exception 'Action link missing or history executed a proposal'; end if;
  replay := public.begin_ai_chat_turn(actor,chat,test_request,0);
  if replay->'response'->>'output' <> 'Synthetic remembered answer' then raise exception 'Completed request did not replay'; end if;
  if not exists(select 1 from public.ai_conversations where id=chat and version=1 and active_request is null and summary='Earlier user excerpt') then raise exception 'Conversation version, summary or lock is incorrect'; end if;

  begin
    perform public.begin_ai_chat_turn(actor,chat,gen_random_uuid(),0);
    raise exception 'FAIL: stale second tab overwrote newer conversation';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform public.begin_ai_chat_turn(actor,chat,failed_request,1);
  perform public.fail_ai_chat_turn(stranger,chat,failed_request);
  if not exists(select 1 from public.ai_conversations where id=chat and active_request=failed_request) then raise exception 'Wrong user released a request'; end if;
  perform public.fail_ai_chat_turn(actor,chat,failed_request);
  if exists(select 1 from public.ai_conversations where id=chat and active_request is not null) then raise exception 'Failed request did not release its lock'; end if;

  if (select count(*) from public.search_ai_conversations(actor,'admin','test-access','test-scope',false,'filaments',0)) <> 1 then raise exception 'Message search failed'; end if;
  if exists(select 1 from public.search_ai_conversations(stranger,'admin','test-access','test-scope',false,'',0)) then raise exception 'Search leaked another user'; end if;
  if exists(select 1 from public.search_ai_conversations(actor,'viewer','test-access','test-scope',false,'',0)) then raise exception 'Search leaked a previous role transcript'; end if;
  if exists(select 1 from public.search_ai_conversations(actor,'admin','revoked','test-scope',false,'',0)) then raise exception 'Search ignored changed mailbox access'; end if;
  update public.ai_conversations set pinned=true,archived=true,title='Renamed regression conversation' where id=chat;
  if exists(select 1 from public.search_ai_conversations(actor,'admin','test-access','test-scope',false,'',0)) then raise exception 'Archive filter failed'; end if;
  if (select count(*) from public.search_ai_conversations(actor,'admin','test-access','test-scope',true,'renamed',0)) <> 1 then raise exception 'Archived title search failed'; end if;

  insert into public.ai_usage_events(user_id,conversation_id,request_id,call_index,provider,model,input_tokens,output_tokens,total_tokens,estimated_cost_usd,success)
    values(actor,chat,test_request,0,'test','synthetic',20,5,25,0.001,true);
  insert into public.ai_usage_events(user_id,conversation_id,request_id,call_index,provider,model,success)
    values(actor,chat,test_request,1,'test','synthetic',false);
  totals := public.ai_chat_usage_totals(actor,now());
  if (totals->>'totalTokens')::integer <> 25 or (totals->>'calls')::integer <> 2 or (totals->>'requests')::integer <> 1 or (totals->>'unreportedCalls')::integer <> 1 then raise exception 'Usage totals are inaccurate'; end if;
  if (public.ai_chat_usage_totals(stranger,now())->>'calls')::integer <> 0 then raise exception 'Usage leaked another user'; end if;

  foreach table_name in array array['ai_conversations','ai_chat_messages','ai_chat_turns','ai_usage_events'] loop
    if not (select relrowsecurity from pg_class where oid=('public.'||table_name)::regclass) then raise exception 'RLS missing on %',table_name; end if;
    if has_table_privilege('authenticated','public.'||table_name,'SELECT') or has_table_privilege('authenticated','public.'||table_name,'INSERT') or has_table_privilege('anon','public.'||table_name,'SELECT') then raise exception 'Browser can forge or read private history table %',table_name; end if;
  end loop;
  if has_function_privilege('authenticated','public.begin_ai_chat_turn(uuid,uuid,uuid,integer)','EXECUTE') or has_function_privilege('anon','public.ai_chat_usage_totals(uuid,timestamptz)','EXECUTE') then raise exception 'Private RPC exposed to browsers'; end if;

  delete from public.ai_conversations where id=chat;
  if exists(select 1 from public.ai_chat_messages where conversation_id=chat) or exists(select 1 from public.ai_chat_turns where conversation_id=chat) then raise exception 'Deletion did not remove transcript'; end if;
  if not exists(select 1 from public.workspace_agent_actions where id=test_action and conversation_id is null) then raise exception 'Transcript deletion removed the test_action audit record'; end if;
  if not exists(select 1 from public.ai_usage_events where request_id=test_request and conversation_id is null) then raise exception 'Deletion lost aggregate usage'; end if;
end $$;
rollback;

select 'AI history database assertions passed; all test data rolled back' as result;
