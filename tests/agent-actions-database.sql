-- Transactional assertions; no invoice, email, user, or proposal survives this test.
begin;
do $$
declare
  actor uuid;
  proposal uuid := gen_random_uuid();
  affected integer;
begin
  select user_id into actor from public.workspace_members where activated_at is not null limit 1;
  if actor is null then raise exception 'An active test workspace member is required'; end if;
  insert into public.workspace_agent_actions(id,user_id,action,approval_mode)
    values(proposal,actor,'{"type":"test"}','ask');
  update public.workspace_agent_actions set status='running',approval='manual' where id=proposal and user_id=actor and status='pending';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'First approval did not claim the action'; end if;
  update public.workspace_agent_actions set status='running' where id=proposal and user_id=actor and status='pending';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'A repeated approval claimed the action twice'; end if;
  if has_table_privilege('authenticated','public.workspace_agent_actions','INSERT') or has_table_privilege('authenticated','public.workspace_agent_actions','UPDATE') then
    raise exception 'Browser users must not forge proposals or reset approval state';
  end if;
  if has_table_privilege('anon','public.workspace_agent_actions','SELECT') then raise exception 'Anonymous users can read agent proposals'; end if;
  if not (select relrowsecurity from pg_class where oid='public.workspace_agent_actions'::regclass) then raise exception 'RLS must be enabled'; end if;
end $$;
rollback;
