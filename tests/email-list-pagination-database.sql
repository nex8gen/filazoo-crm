begin;
set local statement_timeout='15s';
do $test$
declare
  tenant uuid := crm_tenancy.workspace_id(); actor uuid;
  key text := repeat(replace(gen_random_uuid()::text,'-',''),2);
  box uuid := gen_random_uuid(); a jsonb; b jsonb; last_page jsonb; payload jsonb; folders jsonb;
begin
  select user_id into actor from public.workspace_members where workspace_id=tenant limit 1;
  select jsonb_agg(jsonb_build_object('id','fixture-'||n,'subject','Pagination fixture '||n,'contact','fixture@example.invalid',
    'company','Fixture','direction','inbound','status','Received','timestamp','2026-11-27T00:00:00Z'::timestamptz-make_interval(mins=>n),
    'messageId','<pagination-'||n||'@example.invalid>','preview','Saved preview','body','Private body payload',
    'read',n%2=0,'folder',case when n>72 then 'trash' else 'inbox' end)) into payload from generate_series(1,75) n;
  payload := payload || jsonb_build_array(
    jsonb_build_object('id','fixture-reply','subject','Re: Pagination fixture 70','contact','fixture@example.invalid','company','Fixture','direction','outbound','status','Sent','timestamp','2026-11-26T00:00:00Z','messageId','<reply@example.invalid>','inReplyTo','<pagination-70@example.invalid>','references',jsonb_build_array('<pagination-70@example.invalid>'),'body','Reply body'),
    jsonb_build_object('id','fixture-child','subject','Re: Pagination fixture 70','contact','fixture@example.invalid','company','Fixture','direction','inbound','status','Received','timestamp','2026-11-26T01:00:00Z','messageId','<child@example.invalid>','inReplyTo','<reply@example.invalid>','references',jsonb_build_array('<reply@example.invalid>'),'body','Child body'));
  insert into public.mailbox_sync_state(workspace_id,mailbox_key,messages,synced_at) values(tenant,key,payload,now());
  folders := jsonb_build_array(jsonb_build_object('key',key,'path','INBOX','kind','inbox'));
  a := public.crm_email_list_page(actor,box,folders,true);
  b := public.crm_email_list_page_snapshot(actor,box,folders,true);
  if b-'revision'<>a or nullif(b->>'revision','') is null then raise exception 'Page snapshot changed results or omitted revision'; end if;
  if has_function_privilege('authenticated','public.crm_email_list_page_snapshot(uuid,uuid,jsonb,boolean,uuid,text,text,text,text,text,jsonb,integer,text)','execute') then raise exception 'Page snapshot publicly accessible'; end if;
  b := public.crm_email_list_page(actor,box,folders,true,p_page=>2);
  last_page := public.crm_email_list_page(actor,box,folders,true,p_page=>999999);
  if (a->>'total')::int<>72 or jsonb_array_length(a->'emails')<>30 then raise exception 'First email page failed'; end if;
  if (b->>'total')::int<>72 or jsonb_array_length(b->'emails')<>30 then raise exception 'Second email page failed'; end if;
  if exists(select 1 from jsonb_array_elements(a->'emails') x join jsonb_array_elements(b->'emails') y on x->>'id'=y->>'id') then raise exception 'Pages overlap'; end if;
  if (last_page->>'page')::int<>3 or jsonb_array_length(last_page->'emails')<>14 then raise exception 'Last page lost conversation replies'; end if;
  if exists(select 1 from jsonb_array_elements(a->'emails') x where x->>'body'<>'' or (x->>'bodyLoaded')::boolean) then raise exception 'List downloaded full bodies'; end if;
  if (a->'folderCounts'->>'trash')::int<>3 then raise exception 'Folder counts only cover a page'; end if;
  a := public.crm_email_list_page(actor,box,folders,true,p_query=>'Pagination fixture 70');
  if (a->>'total')::int<>1 or jsonb_array_length(a->'emails')<>3 then raise exception 'Search split a conversation'; end if;
  a := public.crm_email_list_page(actor,box,folders,true,p_folder=>'trash');
  if (a->>'total')::int<>3 then raise exception 'Trash filter failed'; end if;
  insert into public.crm_email_tags(workspace_id,message_key,contact_email,tag,source)
    values(tenant,'conversation:message:<pagination-70@example.invalid>','fixture@example.invalid','New Inquiries','manual');
  a := public.crm_email_list_page(actor,box,folders,true,p_tag=>'New Inquiries');
  if (a->>'total')::int<>1 or jsonb_array_length(a->'emails')<>3 then raise exception 'Tag filter missed later page or parent references'; end if;
  a := public.crm_email_list_page(actor,box,folders,true,p_owner=>gen_random_uuid());
  if (a->>'total')::int<>0 then raise exception 'BD scope failed'; end if;
  a := public.crm_email_list_page(actor,box,folders,true,p_thread=>'fixture-70');
  if (a->>'page')::int<>3 then raise exception 'Deep link did not choose its page'; end if;
  if has_function_privilege('anon','public.crm_email_list_page(uuid,uuid,jsonb,boolean,uuid,text,text,text,text,text,jsonb,integer,text)','execute')
    or has_function_privilege('authenticated','public.crm_email_list_page(uuid,uuid,jsonb,boolean,uuid,text,text,text,text,text,jsonb,integer,text)','execute') then raise exception 'Private RPC publicly accessible'; end if;
end $test$;
rollback;
select 'Email pagination database checks passed; fixtures rolled back.' result;
