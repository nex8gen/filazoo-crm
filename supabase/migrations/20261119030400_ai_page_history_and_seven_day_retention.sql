begin;

-- Page browsing includes Chat and Agent across records on that exact page.
-- Resume and turn ownership continue to use the full, unchanged record scope.
create function public.search_page_ai_conversations(
  p_user_id uuid, p_role text, p_access_key text, p_pathname text,
  p_archived boolean, p_search text, p_offset integer
) returns setof public.ai_conversations
language sql stable security invoker set search_path = public, pg_temp as $$
  select c.* from public.ai_conversations c
  where c.user_id=p_user_id and c.owner_role=p_role and c.access_key=p_access_key
    and c.pathname=p_pathname and c.mode in ('chat','agent')
    and c.archived=p_archived and c.version>0
    and c.created_at>now()-interval '7 days'
    and (p_search='' or to_tsvector('simple',c.title) @@ plainto_tsquery('simple',p_search)
      or exists(select 1 from public.ai_chat_messages m where m.conversation_id=c.id
        and to_tsvector('simple',m.content) @@ plainto_tsquery('simple',p_search)))
  order by c.pinned desc,c.updated_at desc,c.id
  limit 31 offset greatest(0,least(p_offset,10000));
$$;

-- Home's combined index also includes customer chats, opened on their customer page.
create or replace function public.search_workspace_ai_conversations(
  p_user_id uuid, p_role text, p_access_key text,
  p_archived boolean, p_search text, p_offset integer
) returns setof public.ai_conversations
language sql stable security invoker set search_path = public, pg_temp as $$
  select c.* from public.ai_conversations c
  where c.user_id=p_user_id and c.owner_role=p_role and c.access_key=p_access_key
    and c.archived=p_archived and c.version>0 and c.created_at>now()-interval '7 days'
    and (p_search='' or to_tsvector('simple',c.title) @@ plainto_tsquery('simple',p_search)
      or exists(select 1 from public.ai_chat_messages m where m.conversation_id=c.id
        and to_tsvector('simple',m.content) @@ plainto_tsquery('simple',p_search)))
  order by c.pinned desc,c.updated_at desc,c.id
  limit 31 offset greatest(0,least(p_offset,10000));
$$;

create or replace function public.search_ai_conversations(
  p_user_id uuid, p_role text, p_access_key text, p_scope text,
  p_archived boolean, p_search text, p_offset integer
) returns setof public.ai_conversations
language sql stable security invoker set search_path = public, pg_temp as $$
  select c.* from public.ai_conversations c
  where c.user_id=p_user_id and c.owner_role=p_role and c.access_key=p_access_key
    and c.scope=p_scope and c.archived=p_archived and c.created_at>now()-interval '7 days'
    and (p_search='' or to_tsvector('simple',c.title) @@ plainto_tsquery('simple',p_search)
      or exists(select 1 from public.ai_chat_messages m where m.conversation_id=c.id
        and to_tsvector('simple',m.content) @@ plainto_tsquery('simple',p_search)))
  order by c.pinned desc,c.updated_at desc,c.id
  limit 31 offset greatest(0,least(p_offset,10000));
$$;

create index ai_conversations_expiry on public.ai_conversations(created_at,id);
create index ai_conversations_page_history on public.ai_conversations(user_id,owner_role,access_key,pathname,archived,pinned desc,updated_at desc,id) where version>0;

-- Invoker permissions preserve workspace RLS for application calls. The scheduler
-- runs as postgres and expires all workspaces, even when nobody opens the app.
create function public.purge_expired_ai_conversations() returns integer
language plpgsql security invoker set search_path = public, pg_temp as $$
declare c record; removed integer := 0;
begin
  for c in
    select h.id from public.ai_conversations h
    where h.created_at<=now()-interval '7 days'
      and not exists(select 1 from public.ai_chat_turns t
        where t.request_id=h.active_request and t.conversation_id=h.id
          and t.status='pending' and t.created_at>now()-interval '5 minutes')
    order by h.created_at,h.id limit 500 for update of h skip locked
  loop
    update public.workspace_agent_actions set status='declined',finished_at=clock_timestamp()
      where conversation_id=c.id and status='pending';
    -- Messages and idempotent response payloads cascade; completed CRM actions
    -- and usage accounting keep their existing audit records.
    delete from public.ai_conversations where id=c.id;
    removed := removed+1;
  end loop;
  return removed;
end;
$$;

revoke all on function public.search_page_ai_conversations(uuid,text,text,text,boolean,text,integer),public.purge_expired_ai_conversations() from public,anon,authenticated;
grant execute on function public.search_page_ai_conversations(uuid,text,text,text,boolean,text,integer),public.purge_expired_ai_conversations() to service_role;
do $$ begin
  if exists(select 1 from pg_roles where rolname='crm_workspace_server') then
    grant execute on function public.search_page_ai_conversations(uuid,text,text,text,boolean,text,integer) to crm_workspace_server;
  end if;
end $$;

create extension if not exists pg_cron;
select cron.schedule('filazoo-ai-history-retention','* * * * *','select public.purge_expired_ai_conversations();');
notify pgrst,'reload schema';
commit;
