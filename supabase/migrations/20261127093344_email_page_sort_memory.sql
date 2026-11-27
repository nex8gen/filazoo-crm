begin;
set local lock_timeout='5s';
-- Large inboxes merge duplicate provider folders and group whole conversations.
-- Scope the sort budget to this private reader instead of increasing database-
-- wide memory use. EXPLAIN on 4,978 conversations: 18,297 -> 5,985 temp blocks.
alter function public.crm_email_list_page(uuid,uuid,jsonb,boolean,uuid,text,text,text,text,text,jsonb,integer,text)
  set work_mem='16MB';
commit;
