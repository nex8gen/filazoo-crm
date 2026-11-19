-- Retention assertions only use synthetic rows, and every change rolls back.
begin;
set local statement_timeout='15s';
do $$
declare
  actor uuid; tenant uuid; other_tenant uuid := gen_random_uuid();
  email_chat uuid := gen_random_uuid(); email_agent uuid := gen_random_uuid();
  product_chat uuid := gen_random_uuid(); customer_chat uuid := gen_random_uuid();
  expired uuid := gen_random_uuid(); busy uuid := gen_random_uuid();
  test_request uuid := gen_random_uuid(); pending_action uuid := gen_random_uuid();
  done_action uuid := gen_random_uuid(); key text := gen_random_uuid()::text;
begin
  select user_id,workspace_id into actor,tenant from public.workspace_members where activated_at is not null limit 1;
  if actor is null then raise exception 'An active member is required'; end if;
  perform set_config('crm.workspace_id',tenant::text,true);
  insert into public.workspaces(id,name,slug) values(other_tenant,'History test workspace','history-test-'||other_tenant);
  insert into public.ai_conversations(id,workspace_id,user_id,owner_role,access_key,mode,pathname,scope,version,created_at) values
    (email_chat,tenant,actor,'admin',key,'chat','/email','email-record-one',1,now()),
    (email_agent,tenant,actor,'admin',key,'agent','/email','email-record-two',1,now()),
    (product_chat,tenant,actor,'admin',key,'chat','/products','product-record',1,now()),
    (customer_chat,tenant,actor,'admin',key,'customer','/companies/'||gen_random_uuid(),'customer-record',1,now()),
    (expired,tenant,actor,'admin',key,'agent','/email','expired-record',1,now()-interval '7 days'),
    (busy,tenant,actor,'admin',key,'agent','/email','busy-record',1,now()-interval '8 days'),
    -- Identical UUID in another workspace must survive the old tenant's deletion.
    (expired,other_tenant,actor,'admin',key,'agent','/email','another-tenant-record',1,now());
  update public.ai_conversations set pinned=true,archived=true,updated_at=now() where id=expired and workspace_id=tenant;
  insert into public.ai_chat_messages(workspace_id,conversation_id,turn,role,content) values
    (tenant,email_agent,1,'user','syntheticneedle'),(tenant,expired,1,'user','synthetic expired message');
  insert into public.ai_chat_turns(workspace_id,request_id,conversation_id,status) values(tenant,test_request,busy,'pending');
  update public.ai_conversations set active_request=test_request where id=busy and workspace_id=tenant;
  insert into public.workspace_agent_actions(id,workspace_id,user_id,conversation_id,action,approval_mode,status) values
    (pending_action,tenant,actor,expired,'{"type":"test"}','ask','pending'),
    (done_action,tenant,actor,expired,'{"type":"test"}','ask','completed');

  set local role crm_workspace_server;
  if (select count(*) from public.search_page_ai_conversations(actor,'admin',key,'/email',false,'',0))<>2 then raise exception 'Page history mixed pages or missed modes'; end if;
  if (select count(*) from public.search_page_ai_conversations(actor,'admin',key,'/email',false,'syntheticneedle',0))<>1 then raise exception 'Page message search failed'; end if;
  if exists(select 1 from public.search_page_ai_conversations(actor,'viewer',key,'/email',false,'',0)) then raise exception 'Page search leaked role'; end if;
  if (select count(*) from public.search_workspace_ai_conversations(actor,'admin',key,false,'',0))<>4 then raise exception 'Home history missed a page or customer chat'; end if;
  if exists(select 1 from public.search_ai_conversations(actor,'admin',key,'expired-record',true,'',0)) then raise exception 'Pinned archived chat survived the seven-day boundary'; end if;

  reset role;
  perform public.purge_expired_ai_conversations();
  if exists(select 1 from public.ai_conversations where id=expired and workspace_id=tenant) then raise exception 'Expired chat was not deleted'; end if;
  if exists(select 1 from public.ai_chat_messages where conversation_id=expired and workspace_id=tenant) then raise exception 'Expired messages survived'; end if;
  if not exists(select 1 from public.ai_conversations where id=expired and workspace_id=other_tenant) then raise exception 'Cleanup deleted another tenant with the same UUID'; end if;
  if not exists(select 1 from public.workspace_agent_actions where id=pending_action and status='declined' and conversation_id is null) then raise exception 'Pending proposal remained executable'; end if;
  if not exists(select 1 from public.workspace_agent_actions where id=done_action and status='completed' and conversation_id is null) then raise exception 'Completed CRM audit was lost'; end if;
  if not exists(select 1 from public.ai_conversations where id=busy and workspace_id=tenant) then raise exception 'Live turn lost its lease'; end if;
  update public.ai_chat_turns set created_at=now()-interval '6 minutes' where request_id=test_request and workspace_id=tenant;
  perform public.purge_expired_ai_conversations();
  if exists(select 1 from public.ai_conversations where id=busy and workspace_id=tenant) then raise exception 'Stale turn prevented expiry'; end if;
  if exists(select 1 from public.ai_chat_turns where request_id=test_request and workspace_id=tenant) then raise exception 'Expired response payload survived'; end if;
end $$;
rollback;
select 'AI page history and seven-day retention assertions passed; test data rolled back' as result;
