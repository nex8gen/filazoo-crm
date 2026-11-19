begin;

-- Match composite tenant keys even if two workspaces have the same record UUID.
create or replace function public.purge_expired_ai_conversations() returns integer
language plpgsql security invoker set search_path = public, pg_temp as $$
declare c record; removed integer := 0;
begin
  for c in
    select h.workspace_id,h.id from public.ai_conversations h
    where h.created_at<=now()-interval '7 days'
      and not exists(select 1 from public.ai_chat_turns t
        where t.workspace_id=h.workspace_id and t.request_id=h.active_request
          and t.conversation_id=h.id and t.status='pending'
          and t.created_at>now()-interval '5 minutes')
    order by h.created_at,h.id limit 500 for update of h skip locked
  loop
    update public.workspace_agent_actions set status='declined',finished_at=clock_timestamp()
      where workspace_id=c.workspace_id and conversation_id=c.id and status='pending';
    delete from public.ai_conversations where workspace_id=c.workspace_id and id=c.id;
    removed := removed+1;
  end loop;
  return removed;
end;
$$;

commit;
