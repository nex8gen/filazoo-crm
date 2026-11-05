begin;

-- Browsing is account-wide; automatic resume still uses the exact record scope.
-- Keep the same owner, role and access fingerprint requirements as transcripts.
create or replace function public.search_workspace_ai_conversations(
  p_user_id uuid, p_role text, p_access_key text,
  p_archived boolean, p_search text, p_offset integer
) returns setof public.ai_conversations
language sql stable security invoker set search_path = public, pg_temp as $$
  select c.* from public.ai_conversations c
  where c.user_id = p_user_id and c.owner_role = p_role
    and c.access_key = p_access_key and c.archived = p_archived
    and c.mode in ('chat', 'agent') and c.version > 0
    and (p_search = ''
      or to_tsvector('simple', c.title) @@ plainto_tsquery('simple', p_search)
      or exists (
        select 1 from public.ai_chat_messages m
        where m.conversation_id = c.id
          and to_tsvector('simple', m.content) @@ plainto_tsquery('simple', p_search)
      ))
  order by c.pinned desc, c.updated_at desc, c.id
  limit 31 offset greatest(0, least(p_offset, 10000));
$$;

revoke all on function public.search_workspace_ai_conversations(uuid, text, text, boolean, text, integer) from public, anon, authenticated;
grant execute on function public.search_workspace_ai_conversations(uuid, text, text, boolean, text, integer) to service_role;

commit;
