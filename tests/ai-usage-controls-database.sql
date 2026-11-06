-- Synthetic records and settings changes all roll back; no model is called.
begin;
set local role service_role;
do $$
declare
  actor uuid; outsider uuid := gen_random_uuid(); settings jsonb; saved jsonb; result jsonb;
  chat uuid := gen_random_uuid(); turn_id uuid := gen_random_uuid();
  pending_action uuid := gen_random_uuid(); completed_action uuid := gen_random_uuid();
  baseline_reservations bigint; baseline_usage bigint; rejected boolean;
begin
  select user_id into strict actor from public.workspace_members where role='admin' and activated_at is not null order by created_at limit 1;
  select count(*) into baseline_reservations from public.ai_budget_reservations;
  select count(*) into baseline_usage from public.ai_usage_events;
  settings := public.read_ai_usage_settings(actor);
  if not exists(select 1 from jsonb_array_elements(settings->'members') m where m->>'userId'=actor::text) then raise exception 'Admin own account missing'; end if;
  rejected := false;
  begin perform public.read_ai_usage_settings(outsider); exception when others then rejected := true; end;
  if not rejected then raise exception 'Non-admin read usage controls'; end if;
  rejected := false;
  begin perform public.save_ai_usage_settings(outsider,0,settings); exception when others then rejected := true; end;
  if not rejected then raise exception 'Non-admin saved usage controls'; end if;

  settings := jsonb_set(settings,'{members}',jsonb_build_array(jsonb_build_object('userId',actor,'enabled',false,'dailyMicros',null)));
  saved := public.save_ai_usage_settings(actor,(settings->>'revision')::integer,settings);
  result := public.reserve_ai_budget(actor,'openai/gpt-4.1-mini',1);
  if result->>'allowed'<>'false' or result->>'reason'<>'user_disabled' then raise exception 'Paused admin reached paid reservation'; end if;
  if (select count(*) from public.ai_budget_reservations)<>baseline_reservations then raise exception 'Paused request wrote reservation'; end if;
  rejected := false;
  begin perform public.save_ai_usage_settings(actor,(settings->>'revision')::integer,settings); exception when others then if sqlerrm='AI usage settings changed' then rejected := true; else raise; end if; end;
  if not rejected then raise exception 'Stale policy overwrite accepted'; end if;
  saved := jsonb_set(saved,'{members}',jsonb_build_array(jsonb_build_object('userId',actor,'enabled',true,'dailyMicros',0)));
  saved := public.save_ai_usage_settings(actor,(saved->>'revision')::integer,saved);
  result := public.read_ai_budget(actor);
  if (result#>>'{daily,limitMicros}')::bigint<>0 or (result#>>'{daily,percent}')::integer<>100 then raise exception 'Zero cap not handled'; end if;
  result := public.reserve_ai_budget(actor,'openai/gpt-4.1-mini',1);
  if result->>'allowed'<>'false' then raise exception 'Zero daily cap allowed spending'; end if;
  saved := jsonb_set(saved,'{members}',jsonb_build_array(jsonb_build_object('userId',actor,'enabled',true,'dailyMicros',123456)));
  saved := public.save_ai_usage_settings(actor,(saved->>'revision')::integer,saved);
  result := public.read_ai_budget(actor);
  if (result#>>'{daily,limitMicros}')::bigint<>123456 then raise exception 'Custom user cap not applied'; end if;
  saved := jsonb_set(saved,'{dailyMicros}','0'::jsonb);
  saved := public.save_ai_usage_settings(actor,(saved->>'revision')::integer,saved);
  if (public.read_ai_budget(actor)#>>'{workspaceDaily,remainingMicros}')::bigint<>0 then raise exception 'Workspace daily cap not applied'; end if;
  if (select count(*) from public.ai_usage_events)<>baseline_usage then raise exception 'Policy changed historical billing'; end if;

  insert into public.ai_conversations(id,user_id,owner_role,access_key,mode,pathname,scope)
    values(chat,actor,'admin','synthetic-old-access','chat','/companies','synthetic-history');
  perform public.begin_ai_chat_turn(actor,chat,turn_id,0);
  insert into public.ai_chat_messages(conversation_id,turn,role,content) values(chat,1,'user','Synthetic history deletion');
  insert into public.workspace_agent_actions(id,user_id,conversation_id,action,approval_mode,status)
    values(pending_action,actor,chat,'{"type":"test"}','ask','pending'),(completed_action,actor,chat,'{"type":"test"}','ask','completed');
  insert into public.ai_usage_events(user_id,conversation_id,request_id,call_index,provider,model,success) values(actor,chat,turn_id,0,'synthetic','synthetic',false);
  result := public.delete_ai_conversation(actor,chat);
  if result->>'pending'<>'true' then raise exception 'Live turn lock ignored'; end if;
  update public.ai_chat_turns set created_at=clock_timestamp()-interval '6 minutes' where request_id=turn_id;
  result := public.delete_ai_conversation(actor,chat);
  if result->>'success'<>'true' then raise exception 'Stale turn blocked deletion'; end if;
  if exists(select 1 from public.ai_conversations where id=chat) or exists(select 1 from public.ai_chat_messages where conversation_id=chat) or exists(select 1 from public.ai_chat_turns where conversation_id=chat) then raise exception 'Transcript not deleted'; end if;
  if not exists(select 1 from public.workspace_agent_actions where id=pending_action and status='declined' and conversation_id is null) then raise exception 'Pending proposal still executable or lost'; end if;
  if not exists(select 1 from public.workspace_agent_actions where id=completed_action and status='completed' and conversation_id is null) then raise exception 'Completed audit action lost'; end if;
  if not exists(select 1 from public.ai_usage_events where request_id=turn_id and conversation_id is null) then raise exception 'Usage was erased with transcript'; end if;
  if public.delete_ai_conversation(actor,chat)->>'success'<>'false' then raise exception 'Missing transcript incorrectly matched'; end if;
  if has_function_privilege('authenticated','public.save_ai_usage_settings(uuid,integer,jsonb)','execute')
    or has_function_privilege('anon','public.read_ai_usage_settings(uuid)','execute')
    or has_function_privilege('authenticated','public.delete_ai_conversation(uuid,uuid)','execute') then raise exception 'Private controls exposed to browser roles'; end if;
end $$;
rollback;
