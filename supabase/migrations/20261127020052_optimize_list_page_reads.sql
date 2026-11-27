begin;
set local lock_timeout = '5s';

create or replace function public.crm_mail_id(p text) returns text
language sql immutable security invoker set search_path='' as $$
  select nullif(lower(coalesce(substring(btrim(p) from '<[^<>[:space:]]+>'),btrim(p))),'');
$$;

-- Saved mail stays in PostgreSQL. Only the requested conversation page leaves
-- the database. The server supplies authorized mailbox keys and actor scope.
create or replace function public.crm_email_list_page(
  p_actor uuid,p_mailbox uuid,p_folders jsonb,p_personal boolean,p_owner uuid default null,
  p_folder text default 'inbox',p_query text default '',p_source text default 'all',p_tag text default '',
  p_followup text default 'all',p_actions jsonb default '[]',p_page integer default 1,p_thread text default null
) returns jsonb language sql stable security invoker set search_path='' set jit=off as $$
with recursive provider as materialized (
  select m as raw,coalesce(public.crm_mail_id(m->>'messageId'),m->>'id') identity,s.mailbox_key,f->>'path' path,f->>'kind' kind,
    case f->>'kind' when 'sent' then 5 when 'inbox' then 4 when 'drafts' then 3 when 'spam' then 2 when 'trash' then 2 when 'custom' then 1 else 0 end priority
  from jsonb_array_elements(p_folders) f
  join public.mailbox_sync_state s on s.workspace_id=(select crm_tenancy.workspace_id()) and s.mailbox_key=f->>'key'
  cross join lateral jsonb_array_elements(s.messages) m
  where coalesce((m->>'providerRemoved')::boolean,false)=false
), provider_locations as materialized (
  select identity,
    jsonb_agg(jsonb_build_object('folder',path,'kind',kind,'mailboxKey',mailbox_key,'uid',raw->'uid','validity',raw->'uidValidity')) locations
  from provider group by 1
), provider_dedup as (
  select distinct on(provider.identity)
    provider.identity,
    (raw-'html'-'body')||jsonb_build_object('mailboxId',p_mailbox,'mailboxKey',mailbox_key,'providerFolder',path,'providerKind',kind,
      'body','','bodyLoaded',false,'source','mailbox','direction',coalesce(raw->>'direction',case when kind='sent' then 'outbound' else 'inbound' end),
      'folder',coalesce(raw->>'folder',case when kind in ('archive','trash') then kind else 'inbox' end),
      'providerLocations',locations.locations) item,
    case when p_query='' then '' else concat_ws(' ',raw->>'subject',raw->>'contact',raw->>'contactName',raw->>'preview',raw->>'body',raw->>'to',raw->>'attachments') end search_text,priority
  from provider join provider_locations locations on locations.identity=provider.identity
  order by provider.identity,priority desc,mailbox_key
), source_items as (
  select item,search_text,priority from provider_dedup
  union all
  select jsonb_build_object('id','sent-'||s.id,'mailboxId',s.mailbox_id,'from',s.from_email,'to',coalesce(nullif(s.to_recipients,'[]'::jsonb),jsonb_build_array(jsonb_build_object('address',s.to_email))),
    'cc',s.cc_recipients,'bcc',s.bcc_recipients,'direction','outbound','status',case when s.status='sent' then 'Sent' else 'Failed' end,
    'subject',coalesce(s.subject,''),'contact',s.to_email,'company','Direct email','preview','','body','','html',null,'_listPayload','sent',
    'bodyLoaded',true,'timestamp',s.sent_at,'messageId',s.message_id,'threadId',s.thread_key,'inReplyTo',s.in_reply_to,'references',s.reference_ids,
    'attachments',(select coalesce(jsonb_agg(jsonb_build_object('filename',a->>'filename','contentType',a->>'contentType','size',a->'size','cid',a->>'cid')),'[]'::jsonb) from jsonb_array_elements(coalesce(nullif(s.attachments,'null'::jsonb),'[]'::jsonb)) a),
    'providerFolder',pd.item->'providerFolder','providerKind',pd.item->'providerKind','providerLocations',pd.item->'providerLocations','uid',pd.item->'uid','uidValidity',pd.item->'uidValidity','mailboxKey',pd.item->'mailboxKey',
    'read',pd.item->'read','starred',pd.item->'starred','folder',pd.item->'folder'),
    case when p_query='' then '' else concat_ws(' ',s.subject,s.to_email,s.body,s.to_recipients,s.attachments) end,10
  from public.mailbox_sent_messages s left join provider_dedup pd on pd.identity=public.crm_mail_id(s.message_id)
  where s.workspace_id=(select crm_tenancy.workspace_id()) and s.user_id=p_actor and s.mailbox_id=p_mailbox
  union all
  select jsonb_build_object('id',e.id,'crmEmailId',e.id,'mailboxId',e.mailbox_id,'direction',case when e.direction='received' then 'inbound' else 'outbound' end,
    'status',case when e.direction='received' then 'Received' else initcap(replace(e.status,'_',' ')) end,'subject',coalesce(e.subject,'(No subject)'),
    'contact',ct.email,'company',coalesce(c.name,'Unknown company'),'companyId',c.id,'contactName',ct.name,
    'preview','','body','','_listPayload','crm',
    'bodyLoaded',e.message_id is null or e.direction<>'received','source','crm','timestamp',coalesce(e.sent_at,e.created_at),'threadId',e.thread_id,'messageId',e.message_id),
    case when p_query='' then '' else concat_ws(' ',e.subject,e.body,ct.email,ct.name,c.name) end,1
  from public.emails e join public.contacts ct on ct.workspace_id=e.workspace_id and ct.id=e.contact_id
  left join public.companies c on c.workspace_id=ct.workspace_id and c.id=ct.company_id
  where not p_personal and e.workspace_id=(select crm_tenancy.workspace_id()) and e.mailbox_id=p_mailbox
    and (e.direction='received' or e.status in ('draft','pending_approval','approved','scheduled')) and coalesce(e.subject,'') !~* '\[sample\]'
  union all
  select jsonb_build_object('id','shopify-'||s.webhook_id,'direction','inbound','status','Shopify enquiry','subject','Shopify enquiry from '||s.company_name,
    'contact',s.email,'company',s.company_name,'contactName',s.full_name,'source','shopify','threadId','shopify:'||s.webhook_id,
    'timestamp',s.created_at,'body','','bodyLoaded',true,'_listPayload','shopify','leadRow',jsonb_build_object('webhook_id',s.webhook_id)),
    case when p_query='' then '' else concat_ws(' ',s.company_name,s.email,s.full_name,s.raw_payload,s.tags) end,2
  from public.shopify_leads s where not p_personal and s.workspace_id=(select crm_tenancy.workspace_id()) and s.status='processed' and s.duplicate_of is null
  union all
  select jsonb_build_object('id','meta-lead-'||s.leadgen_id,'direction','inbound','status','Meta lead form','subject','Meta enquiry from '||coalesce(s.full_name,s.email),
    'contact',s.email,'company',coalesce(s.full_name,s.email),'companyId',s.company_id,'contactName',s.full_name,'source','crm','threadId','meta-lead:'||s.leadgen_id,
    'timestamp',s.created_at,'body','A customer submitted a Meta lead form.','bodyLoaded',true,'_listPayload','meta','leadRow',jsonb_build_object('leadgen_id',s.leadgen_id)),
    case when p_query='' then '' else concat_ws(' ',s.full_name,s.email,s.field_data) end,2
  from public.meta_leads s where not p_personal and s.workspace_id=(select crm_tenancy.workspace_id()) and s.company_id is not null and s.email is not null
), contact_context as materialized (
  -- Resolve each address once, rather than scanning contacts for every message.
  select distinct on(lower(ct.email::text)) lower(ct.email::text) email,ct.company_id,c.name,ct.name contact_name,ct.role contact_role
  from public.contacts ct join public.companies c on c.workspace_id=ct.workspace_id and c.id=ct.company_id
  where ct.workspace_id=(select crm_tenancy.workspace_id())
    and (p_owner is null or exists(select 1 from public.pipeline p where p.workspace_id=ct.workspace_id and p.company_id=ct.company_id and p.owner_id=p_owner))
  order by lower(ct.email::text),ct.id
), dedup as materialized (
  select distinct on(coalesce(public.crm_mail_id(item->>'messageId'),item->>'id')) item,search_text
  from source_items where p_owner is null or lower(item->>'contact') in(select email from contact_context)
  order by coalesce(public.crm_mail_id(item->>'messageId'),item->>'id'),priority desc,item->>'id'
), messages as materialized (
  select d.item || jsonb_build_object('read',case when nullif(d.item->>'providerFolder','') is not null then coalesce((d.item->>'read')::boolean,false) else coalesce(s.is_read,(d.item->>'read')::boolean,false) end,
    'starred',case when nullif(d.item->>'providerFolder','') is not null then coalesce((d.item->>'starred')::boolean,false) else coalesce(s.starred,(d.item->>'starred')::boolean,false) end,
    'folder',case when nullif(d.item->>'providerFolder','') is not null then coalesce(d.item->>'folder','inbox') else coalesce(s.folder,d.item->>'folder','inbox') end,
    'followUpAt',s.follow_up_at,'companyId',case when p_owner is not null then context.company_id::text else coalesce(d.item->>'companyId',context.company_id::text) end) item,
    concat_ws(' ',d.search_text,context.name) search_text,coalesce(nullif(btrim(d.item->>'threadId'),''),'message:'||coalesce(public.crm_mail_id(d.item->'references'->>0),public.crm_mail_id(d.item->>'inReplyTo'),public.crm_mail_id(d.item->>'messageId')),'local:'||(d.item->>'id')) thread_key
  from dedup d left join public.email_inbox_state s on s.workspace_id=(select crm_tenancy.workspace_id()) and s.user_id=p_actor and s.message_key=d.item->>'id'
  left join contact_context context on context.email=lower(d.item->>'contact')
), links as materialized (
  select m.thread_key a,k b from messages m cross join lateral (
    select 'message:'||public.crm_mail_id(m.item->>'messageId') k union select 'message:'||public.crm_mail_id(m.item->>'inReplyTo')
    union select 'message:'||public.crm_mail_id(v) from jsonb_array_elements_text(coalesce(nullif(m.item->'references','null'::jsonb),'[]'::jsonb)) v
    -- Historical outbound replies without RFC metadata join the newest matching inbound.
    union select parent.thread_key from lateral (select x.thread_key from messages x where m.item->>'direction'='outbound' and m.item->>'subject' ~* '^\s*re\s*:'
      and nullif(m.item->>'threadId','') is null and nullif(m.item->>'inReplyTo','') is null and coalesce(jsonb_array_length(nullif(m.item->'references','null'::jsonb)),0)=0
      and x.item->>'direction'='inbound' and lower(x.item->>'contact')=lower(m.item->>'contact')
      and lower(regexp_replace(x.item->>'subject','^\s*((re|fw|fwd)\s*:\s*)+','','i'))=lower(regexp_replace(m.item->>'subject','^\s*((re|fw|fwd)\s*:\s*)+','','i'))
      and (x.item->>'timestamp')::timestamptz between (m.item->>'timestamp')::timestamptz-interval '30 days' and (m.item->>'timestamp')::timestamptz
      order by (x.item->>'timestamp')::timestamptz desc limit 1) parent
  ) refs where k is not null
), edges as materialized (select a,b from links union select b,a from links),
walk(node,root) as (
  select thread_key,thread_key from messages union select e.b,w.root from walk w join edges e on e.a=w.node
), roots as (select node,min(root) root from walk group by node),
grouped as materialized (select m.*,r.root from messages m join roots r on r.node=m.thread_key),
conversation_base as (
  select root,max((item->>'timestamp')::timestamptz) last_at,
    array_agg(distinct thread_key) thread_keys,
    bool_or(p_query='' or position(lower(p_query) in lower(search_text))>0) matches_query,
    bool_or(p_source='all' or (p_source='shopify' and item->>'source'='shopify') or (p_source='replies' and item->>'direction'='inbound' and item->>'source' is distinct from 'shopify') or (p_source='unread' and item->>'direction'='inbound' and not (item->>'read')::boolean)) matches_source,
    bool_or(item->>'id'=p_thread or item->>'threadId'=p_thread or root=p_thread) target
  from grouped group by root
), tag_keys as (
  select root,'conversation:'||thread_key key,1 priority from grouped
  union select root,'conversation:message:'||coalesce(public.crm_mail_id(item->'references'->>0),public.crm_mail_id(item->>'inReplyTo'),public.crm_mail_id(item->>'messageId')),1 from grouped
  union select root,coalesce('imap-'||public.crm_mail_id(item->>'messageId'),item->>'id'),0 from grouped
  union select root,'conversation:'||v,1 from grouped cross join lateral jsonb_array_elements_text(coalesce(nullif(item->'tagThreadAliases','null'::jsonb),'[]'::jsonb)) v
), conversation_tags as (
  select distinct on(k.root) k.root,case when t.tag in ('Long-term Inactive Customers','Postponed Purchasing') then 'Inactive Customers' else t.tag end tag
  from tag_keys k join public.crm_email_tags t on t.workspace_id=(select crm_tenancy.workspace_id()) and t.message_key=k.key
  order by k.root,k.priority desc,t.updated_at desc
), action_keys as (
  select a,key from jsonb_array_elements(p_actions) a cross join lateral (
    select public.crm_mail_id(a->>'messageKey') key union select public.crm_mail_id('local:'||(a->>'messageKey'))
    union select public.crm_mail_id('thread:'||(a->>'threadKey'))
    union select public.crm_mail_id(anchor) from jsonb_array_elements_text(coalesce(nullif(a->'anchors','null'::jsonb),'[]'::jsonb)) anchor
    union select 'company:'||(a->>'companyId') where a->>'source'='workflow'
  ) keys where key is not null
), message_action_keys as (
  select root,key from grouped g cross join lateral (
    select public.crm_mail_id(g.item->>'id') key union select public.crm_mail_id('local:'||(g.item->>'id'))
    union select public.crm_mail_id('thread:'||g.thread_key) union select 'company:'||(g.item->>'companyId')
    union select public.crm_mail_id(g.item->>'messageId')
    union select public.crm_mail_id(v) from jsonb_array_elements_text(coalesce(nullif(g.item->'references','null'::jsonb),'[]'::jsonb)) v
  ) keys where key is not null
), matched_actions as (
  select distinct m.root,a.a from message_action_keys m join action_keys a on a.key=m.key
), action_states as (
  select root,case when a->>'status' in ('sent','cancelled') or a->>'taskStatus' in ('done','cancelled') then 'completed'
    when a->>'kind'='reminder' or a->>'status' in ('failed','uncertain','needs_review','waiting_shipping','paused') then 'manual'
    when a->>'purpose'='nurture' then 'nurture' else 'ai' end state from matched_actions
), conversation_actions as (
  select root,coalesce(array_agg(distinct state) filter(where state<>'completed'),'{}') || case when bool_or(state='completed') and not bool_or(state<>'completed') then array['completed'] else '{}'::text[] end values
  from action_states group by root
), message_folders as (
  select root,f from grouped m cross join lateral (
    select 'provider:'||(m.item->>'providerFolder') f where m.item->>'providerFolder' is not null
    union select 'provider:'||(loc->>'folder') from jsonb_array_elements(coalesce(nullif(m.item->'providerLocations','null'::jsonb),'[]'::jsonb)) loc
    union select 'spam' where m.item->>'providerKind'='spam' and m.item->>'folder'<>'trash'
    union select value from unnest(array['inbox','all','unread','sent','starred','archive','trash','drafts','scheduled']) value
    where (m.item->>'providerKind' is distinct from 'spam' or value='trash') and case value
      when 'inbox' then m.item->>'folder'='inbox' and m.item->>'direction'='inbound' and coalesce(m.item->>'providerKind','inbox')='inbox'
      when 'all' then m.item->>'folder'<>'trash'
      when 'unread' then m.item->>'folder'='inbox' and m.item->>'direction'='inbound' and not (m.item->>'read')::boolean
      when 'sent' then m.item->>'folder'<>'trash' and m.item->>'direction'='outbound'
      when 'starred' then m.item->>'folder'<>'trash' and (m.item->>'starred')::boolean
      when 'drafts' then m.item->>'folder'<>'trash' and lower(m.item->>'status') like '%draft%'
      when 'scheduled' then m.item->>'folder'<>'trash' and lower(m.item->>'status') like '%scheduled%'
      else m.item->>'folder'=value end
  ) folder
), conversation_folders as (
  select root,array_agg(distinct f) folders from message_folders group by root
), conversations as materialized (
  select c.*,t.tag category,coalesce(a.values,'{}'::text[]) followups,coalesce(f.folders,'{}'::text[]) folders
  from conversation_base c left join conversation_tags t using(root) left join conversation_actions a using(root) left join conversation_folders f using(root)
), scoped as materialized (select * from conversations where matches_query and matches_source and (p_tag='' or category=p_tag)),
filtered as materialized (select * from scoped where case when p_folder='followup' then cardinality(followups)>0 and (p_followup='all' or p_followup=any(followups)) else p_folder=any(folders) end),
ordered as (select *,row_number() over(order by last_at desc,root) ordinal from filtered),
bounds as (select count(*) total,greatest(1,least(coalesce((select ceil(ordinal::numeric/30)::integer from ordered where target limit 1),p_page),greatest(1,ceil(count(*)::numeric/30)::integer))) page from filtered),
chosen as (select o.* from ordered o,bounds b where ordinal>(b.page-1)*30 and ordinal<=b.page*30),
page_payloads as (
  -- Full bodies/form payloads are materialized only for the chosen page.
  select (g.item-'_listPayload') || case g.item->>'_listPayload'
    when 'sent' then jsonb_build_object('body',sent.body,'html',sent.body_html,'preview',left(regexp_replace(sent.body,'\s+',' ','g'),160))
    when 'crm' then jsonb_build_object('preview',left(regexp_replace(coalesce(crm.body,''),'\s+',' ','g'),160),'body',case when crm.message_id is null or crm.direction<>'received' then coalesce(crm.body,'No email body available.') else '' end)
    when 'shopify' then jsonb_build_object('leadRow',to_jsonb(shopify),'body',coalesce(shopify.raw_payload->>'contact[body]','A customer submitted the Shopify B2B enquiry form.'))
    when 'meta' then jsonb_build_object('leadRow',to_jsonb(meta)) else '{}'::jsonb end || jsonb_build_object('listConversationKey',c.root,'category',c.category) item,c.ordinal
  from chosen c join grouped g on g.root=c.root
  left join public.mailbox_sent_messages sent on sent.workspace_id=(select crm_tenancy.workspace_id()) and sent.user_id=p_actor and sent.mailbox_id=p_mailbox and sent.id=case when g.item->>'_listPayload'='sent' then substring(g.item->>'id' from 6)::uuid end
  left join public.emails crm on crm.workspace_id=(select crm_tenancy.workspace_id()) and crm.mailbox_id=p_mailbox and crm.id=case when g.item->>'_listPayload'='crm' then (g.item->>'crmEmailId')::uuid end
  left join public.shopify_leads shopify on shopify.workspace_id=(select crm_tenancy.workspace_id()) and shopify.webhook_id=case when g.item->>'_listPayload'='shopify' then g.item->'leadRow'->>'webhook_id' end
  left join public.meta_leads meta on meta.workspace_id=(select crm_tenancy.workspace_id()) and meta.leadgen_id=case when g.item->>'_listPayload'='meta' then g.item->'leadRow'->>'leadgen_id' end
), page_context as (
  select payload.item || jsonb_build_object('company',coalesce(c.name,payload.item->>'company'),'ownerId',p.owner_id,
    'ownerName',case when p.owner_id is null then 'Unassigned' else coalesce(nullif(wm.display_name,''),'BD Sales Manager') end,
    'customerProfile',case when c.id is null then null else jsonb_build_object('companyName',c.name,
      'contactName',coalesce(nullif(payload.item->>'contactName',''),nullif(context.contact_name,''),'No contact yet'),
      'contactRole',coalesce(nullif(context.contact_role,''),'Role not confirmed'),'website',coalesce(c.website,''),
      'country',coalesce(nullif(c.country,''),'Unknown'),'city',coalesce(c.city,''),'segment',coalesce(nullif(c.segment,''),'Unclassified'),
      'summary',coalesce(nullif(cp.summary,''),'This company has not been profiled yet.'),'interests',coalesce(cp.interest_tags,'{}'::text[]),
      'fitScore',coalesce(cp.fit_score,0),'currency',coalesce(p.currency,'USD')) end) item,payload.ordinal
  from page_payloads payload
  left join contact_context context on context.email=lower(payload.item->>'contact')
  left join public.companies c on c.workspace_id=(select crm_tenancy.workspace_id()) and c.id::text=payload.item->>'companyId'
  left join public.pipeline p on p.workspace_id=c.workspace_id and p.company_id=c.id
  left join public.company_profiles cp on cp.workspace_id=c.workspace_id and cp.company_id=c.id
  left join public.workspace_members wm on wm.workspace_id=p.workspace_id and wm.user_id=p.owner_id
)
select jsonb_build_object('emails',coalesce((select jsonb_agg(item order by ordinal,(item->>'timestamp')::timestamptz,item->>'id') from page_context),'[]'::jsonb),
  'contextComplete',true,
  'total',b.total,'page',b.page,'pageSize',30,
  'folderCounts',coalesce((select jsonb_object_agg(folder,n) from (select folder,count(*) n from conversations c cross join lateral unnest(c.folders||case when cardinality(c.followups)>0 then array['followup'] else '{}'::text[] end) folder group by folder) v),'{}'::jsonb),
  'followupCounts',(select jsonb_build_object('all',count(*) filter(where cardinality(followups)>0),'ai',count(*) filter(where 'ai'=any(followups)),'manual',count(*) filter(where 'manual'=any(followups)),'nurture',count(*) filter(where 'nurture'=any(followups)),'completed',count(*) filter(where 'completed'=any(followups))) from scoped),
  'syncedAt',(select max(s.synced_at) from public.mailbox_sync_state s where s.workspace_id=(select crm_tenancy.workspace_id()) and s.mailbox_key in(select f->>'key' from jsonb_array_elements(p_folders) f)),
  'inboxError',(select s.last_error from public.mailbox_sync_state s where s.workspace_id=(select crm_tenancy.workspace_id()) and s.mailbox_key=p_folders->0->>'key')
) from bounds b;
$$;
create or replace function public.crm_email_page_revision(p_actor uuid,p_mailbox uuid,p_keys text[],p_personal boolean)
returns text language sql stable security invoker set search_path='' as $$
select md5(jsonb_build_array(
  (select jsonb_agg(jsonb_build_array(mailbox_key,messages_revision) order by mailbox_key) from public.mailbox_sync_state where workspace_id=crm_tenancy.workspace_id() and mailbox_key=any(p_keys)),
  (select jsonb_build_array(count(*),max(updated_at)) from public.email_inbox_state where workspace_id=crm_tenancy.workspace_id() and user_id=p_actor),
  (select jsonb_build_array(count(*),max(updated_at)) from public.crm_email_tags where workspace_id=crm_tenancy.workspace_id()),
  (select jsonb_build_array(count(*),max(sent_at)) from public.mailbox_sent_messages where workspace_id=crm_tenancy.workspace_id() and user_id=p_actor and mailbox_id=p_mailbox),
  (select jsonb_build_array(count(*),max(updated_at)) from public.emails where not p_personal and workspace_id=crm_tenancy.workspace_id() and mailbox_id=p_mailbox),
  (select jsonb_build_array(count(*),max(updated_at)) from public.shopify_leads where not p_personal and workspace_id=crm_tenancy.workspace_id()),
  (select jsonb_build_array(count(*),max(updated_at)) from public.meta_leads where not p_personal and workspace_id=crm_tenancy.workspace_id()),
  (select jsonb_build_array(count(*),max(updated_at)) from public.email_message_followups where workspace_id=crm_tenancy.workspace_id() and user_id=p_actor and mailbox_id=p_mailbox::text),
  (select md5(coalesce(string_agg(concat_ws(':',r.id,r.status,r.current_step,r.next_run_at,r.finished_at,f.status,f.updated_at),',' order by r.id),''))
    from public.flow_runs r join public.flows f on f.workspace_id=r.workspace_id and f.id=r.flow_id
    where r.workspace_id=crm_tenancy.workspace_id() and f.user_id=p_actor and f.trigger_type='dormant_customer'),
  (select md5(coalesce(string_agg(concat_ws(':',company_id,owner_id),',' order by company_id),'')) from public.pipeline where workspace_id=crm_tenancy.workspace_id()),
  (select max(updated_at) from public.companies where workspace_id=crm_tenancy.workspace_id())
)::text);
$$;
revoke all on function public.crm_email_page_revision(uuid,uuid,text[],boolean) from public,anon,authenticated;
grant execute on function public.crm_email_page_revision(uuid,uuid,text[],boolean) to service_role,crm_workspace_server;
revoke all on function public.crm_mail_id(text) from public,anon,authenticated;
grant execute on function public.crm_mail_id(text) to service_role,crm_workspace_server;
revoke all on function public.crm_email_list_page(uuid,uuid,jsonb,boolean,uuid,text,text,text,text,text,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.crm_email_list_page(uuid,uuid,jsonb,boolean,uuid,text,text,text,text,text,jsonb,integer,text) to service_role,crm_workspace_server;
notify pgrst,'reload schema';

set local lock_timeout = '5s';

-- Private server RPC: RLS scopes every source to the current workspace. The
-- authenticated application supplies p_owner for BD managers before calling it.
create or replace function public.crm_company_list_page(
  p_owner uuid default null, p_rules jsonb default '{}', p_segment text default null,
  p_query text default '', p_country text default 'all', p_tag text default 'all',
  p_sort text default 'createdAt', p_desc boolean default true,
  p_page integer default 1, p_size integer default 25, p_as_of timestamptz default now()
) returns jsonb language sql stable security invoker set search_path='' as $$
with audience as materialized (
  select c.id,c.name,c.created_at,coalesce(c.discovered_at,c.created_at) added_at,
    coalesce(nullif(c.country,''),'Unknown') country,
    coalesce(nullif(c.segment,''),'Unclassified') segment,
    coalesce(nullif(c.domain::text,''),c.website,'No domain') domain,
    coalesce(ct.email::text,'') email,
    case when p.owner_id is null then 'Unassigned' else coalesce(nullif(wm.display_name,''),'BD Sales Manager') end owner_name,
    tags.values as tags
  from public.companies c
  left join public.pipeline p on p.workspace_id=c.workspace_id and p.company_id=c.id
  left join public.workspace_members wm on wm.workspace_id=c.workspace_id and wm.user_id=p.owner_id
  left join public.company_profiles cp on cp.workspace_id=c.workspace_id and cp.company_id=c.id
  left join public.crm_customer_tag_state s on s.workspace_id=c.workspace_id and s.company_id=c.id
  left join lateral (select t.email from public.contacts t where t.workspace_id=c.workspace_id and t.company_id=c.id order by t.created_at,t.id limit 1) ct on true
  cross join lateral (
    -- Match projectCustomerTags: retain manual/flow overrides, suppress stale
    -- communication and commercial assignments when a current rule state exists.
    select coalesce(array_agg(distinct normalized) filter(where normalized in (
      'Prospect Nurturing','New Inquiries','Quotation Follow-up','Active Negotiations',
      'Payment Follow-up','Orders in Fulfillment','Repeat Customers','Inactive Customers',
      'Contacted — waiting for customer','Customer replied')),'{}'::text[]) values
    from (
      select case when t.tag in ('Long-term Inactive Customers','Postponed Purchasing') then 'Inactive Customers' else t.tag end normalized
      from public.crm_email_tags t where t.workspace_id=c.workspace_id and t.company_id=c.id
        and (s.company_id is null or s.facts->>'version' is distinct from 'rules-v1' or t.source in ('manual','flow') or (
          t.tag not in ('Payment Follow-up','Orders in Fulfillment','Repeat Customers','Contacted — waiting for customer','Customer replied')
          and (t.tag<>'New Inquiries' or not exists (
            select 1 from jsonb_array_elements(s.communication) item
            where item->>'status'<>'new' and (item->'keys') ? t.message_key))))
      union all select unnest(s.tags) where s.company_id is not null and s.facts->>'version'='rules-v1'
    ) projected
  ) tags
  where c.workspace_id=(select crm_tenancy.workspace_id()) and c.source is distinct from 'sample_seed'
    and (p_owner is null or p.owner_id=p_owner)
    and (p_segment is null or coalesce(nullif(c.segment,''),'Unclassified')=p_segment)
    and not (p_rules ? 'stage')
    and (not (p_rules ? 'companyIds') or (p_rules->'companyIds') ? c.id::text)
    and (not (p_rules ? 'businessSegment') or coalesce(nullif(c.segment,''),'Unclassified')=p_rules->>'businessSegment')
    and (not (p_rules ? 'country') or coalesce(nullif(c.country,''),'Unknown')=p_rules->>'country')
    and (not (p_rules ? 'source') or coalesce(nullif(c.source,''),'imported')=p_rules->>'source')
    and (not (p_rules ? 'minFitScore') or coalesce(cp.fit_score,0)>=(p_rules->>'minFitScore')::integer)
    and (not (p_rules ? 'hasEmail') or (coalesce(btrim(ct.email::text),'')<>'')=(p_rules->>'hasEmail')::boolean)
), filtered as materialized (
  select * from audience a
  where (p_country='all' or a.country=p_country) and (p_tag='all' or p_tag=any(a.tags))
    and (p_query='' or position(lower(p_query) in lower(concat_ws(' ',a.name,a.domain,a.email,a.segment,a.owner_name,array_to_string(a.tags,' '))))>0)
), bounds as (
  select count(*) total, greatest(1,least(coalesce(p_page,1),greatest(1,ceil(count(*)::numeric/greatest(1,least(p_size,100)))::integer))) page,
    greatest(1,least(p_size,100)) size from filtered
), selected as (
  select a.id, row_number() over(order by
    case when not p_desc then case p_sort when 'name' then lower(a.name) when 'email' then lower(a.email) when 'ownerName' then lower(a.owner_name) when 'country' then lower(a.country) when 'segment' then lower(a.segment) end end asc,
    case when p_desc then case p_sort when 'name' then lower(a.name) when 'email' then lower(a.email) when 'ownerName' then lower(a.owner_name) when 'country' then lower(a.country) when 'segment' then lower(a.segment) end end desc,
    case when not p_desc then case when p_sort='addedAt' then a.added_at else a.created_at end end asc,
    case when p_desc then case when p_sort='addedAt' then a.added_at else a.created_at end end desc,a.id) ordinal
  from filtered a
), recent as (
  select a.*, exists(select 1 from public.invoices i where i.workspace_id=(select crm_tenancy.workspace_id()) and i.company_id=a.id
    and i.status='issued' and i.total_minor>0 and i.paid_minor>=i.total_minor) paying,
    mail.direction,mail.status
  from filtered a
  left join lateral (select e.direction,e.status from public.emails e join public.contacts ct on ct.workspace_id=e.workspace_id and ct.id=e.contact_id
    where ct.workspace_id=(select crm_tenancy.workspace_id()) and ct.company_id=a.id order by e.created_at desc,e.id desc limit 1) mail on true
  where a.added_at>=p_as_of-interval '180 days' and a.added_at<=p_as_of
), buckets as (
  select least(179,floor(extract(epoch from (added_at-(p_as_of-interval '180 days')))/86400)::integer) day_index,
    jsonb_build_array(count(*),
      count(*) filter(where direction is not null or tags && array['Contacted — waiting for customer','Customer replied']),
      count(*) filter(where direction='received' or 'Customer replied'=any(tags)),
      count(*) filter(where tags && array['New Inquiries','Quotation Follow-up','Active Negotiations','Payment Follow-up']),
      count(*) filter(where paying)) counts
  from recent group by 1
)
select jsonb_build_object(
  'ids',coalesce((select jsonb_agg(s.id order by ordinal) from selected s where ordinal>(b.page-1)*b.size and ordinal<=b.page*b.size),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('row',jsonb_build_object(
      'id',c.id,'name',c.name,'website',c.website,'domain',c.domain,'country',c.country,'city',c.city,'segment',c.segment,'source',c.source,
      'status',c.status,'discovered_at',c.discovered_at,'created_at',c.created_at,'company_profiles',to_jsonb(cp),'pipeline',to_jsonb(p),
      'crm_customer_tag_state',to_jsonb(state),
      'crm_email_tags',(select coalesce(jsonb_agg(jsonb_build_object('tag',t.tag,'source',t.source,'message_key',t.message_key)),'[]'::jsonb) from public.crm_email_tags t where t.workspace_id=c.workspace_id and t.company_id=c.id),
      'contacts',(select coalesce(jsonb_agg(jsonb_build_object('id',ct.id,'name',ct.name,'role',ct.role,'email',ct.email,'verification_status',ct.verification_status,
        'emails',(select coalesce(jsonb_agg(to_jsonb(latest)),'[]'::jsonb) from (select e.status,e.direction,e.created_at from public.emails e where e.workspace_id=ct.workspace_id and e.contact_id=ct.id order by e.created_at desc,e.id desc limit 1) latest)) order by ct.created_at,ct.id),'[]'::jsonb)
        from public.contacts ct where ct.workspace_id=c.workspace_id and ct.company_id=c.id)),
      'ownerName',coalesce(nullif(wm.display_name,''),'BD Sales Manager'),
      'paidOrderCount',(select count(distinct case when i.purchase_order_id is null then 'invoice:'||i.id else 'order:'||i.purchase_order_id end)
        from public.invoices i where i.workspace_id=c.workspace_id and i.company_id=c.id and i.status='issued' and i.total_minor>0 and i.paid_minor>=i.total_minor)) order by s.ordinal)
    from selected s join public.companies c on c.workspace_id=(select crm_tenancy.workspace_id()) and c.id=s.id
    left join public.pipeline p on p.workspace_id=c.workspace_id and p.company_id=c.id
    left join public.company_profiles cp on cp.workspace_id=c.workspace_id and cp.company_id=c.id
    left join public.crm_customer_tag_state state on state.workspace_id=c.workspace_id and state.company_id=c.id
    left join public.workspace_members wm on wm.workspace_id=c.workspace_id and wm.user_id=p.owner_id
    where s.ordinal>(b.page-1)*b.size and s.ordinal<=b.page*b.size),'[]'::jsonb),
  'total',b.total,'page',b.page,
  'countries',coalesce((select jsonb_agg(country order by country) from (select distinct country from audience) c),'[]'::jsonb),
  'segments',coalesce((select jsonb_agg(segment order by segment) from (select distinct segment from public.companies c
    where c.workspace_id=(select crm_tenancy.workspace_id()) and c.source is distinct from 'sample_seed'
      and c.segment is not null and c.segment<>'' and c.segment<>'Unclassified'
      and (p_owner is null or exists(select 1 from public.pipeline p where p.workspace_id=c.workspace_id and p.company_id=c.id and p.owner_id=p_owner))) s),'[]'::jsonb),
  'buckets',coalesce((select jsonb_agg(jsonb_build_object('day',day_index,'counts',counts) order by day_index) from buckets),'[]'::jsonb)
) from bounds b;
$$;
revoke all on function public.crm_company_list_page(uuid,jsonb,text,text,text,text,text,boolean,integer,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.crm_company_list_page(uuid,jsonb,text,text,text,text,text,boolean,integer,integer,timestamptz) to service_role,crm_workspace_server;
notify pgrst,'reload schema';

commit;
