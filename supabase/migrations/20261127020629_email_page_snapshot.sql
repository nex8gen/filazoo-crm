begin;
set local lock_timeout='5s';

-- Return the page and its revision in one database snapshot. A separate revision
-- request can otherwise describe newer mail than the page it accompanies.
create or replace function public.crm_email_list_page_snapshot(
  p_actor uuid,p_mailbox uuid,p_folders jsonb,p_personal boolean,p_owner uuid default null,
  p_folder text default 'inbox',p_query text default '',p_source text default 'all',p_tag text default '',
  p_followup text default 'all',p_actions jsonb default '[]',p_page integer default 1,p_thread text default null
) returns jsonb language sql stable security invoker set search_path='' set jit=off as $$
  select public.crm_email_list_page(p_actor,p_mailbox,p_folders,p_personal,p_owner,p_folder,p_query,p_source,p_tag,p_followup,p_actions,p_page,p_thread)
    || jsonb_build_object('revision',public.crm_email_page_revision(p_actor,p_mailbox,array(select f->>'key' from jsonb_array_elements(p_folders) f),p_personal));
$$;
revoke all on function public.crm_email_list_page_snapshot(uuid,uuid,jsonb,boolean,uuid,text,text,text,text,text,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.crm_email_list_page_snapshot(uuid,uuid,jsonb,boolean,uuid,text,text,text,text,text,jsonb,integer,text) to service_role,crm_workspace_server;
notify pgrst,'reload schema';
commit;
