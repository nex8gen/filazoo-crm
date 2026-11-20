begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.crm_customer_tag_state (
  workspace_id uuid not null default crm_tenancy.workspace_id(),
  company_id uuid not null,
  tags text[] not null default '{}',
  communication jsonb not null default '[]',
  facts jsonb not null default '{}',
  processing_status text not null default 'pending' check (processing_status in ('current','pending','waiting_history','needs_review','retrying','paused')),
  processing_reason text,
  checked_at timestamptz,
  next_check_at timestamptz not null default now(),
  primary key (workspace_id,company_id),
  foreign key (workspace_id,company_id) references public.companies(workspace_id,id) on delete cascade
);
create table public.crm_customer_tag_work (
  workspace_id uuid not null default crm_tenancy.workspace_id(),
  company_id uuid not null,
  revision bigint not null default 1,
  processed_revision bigint not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id,company_id),
  foreign key (workspace_id,company_id) references public.companies(workspace_id,id) on delete cascade
);
create index crm_customer_tag_work_pending on public.crm_customer_tag_work(workspace_id,next_attempt_at,updated_at) where revision>processed_revision;
create index crm_customer_tag_state_due on public.crm_customer_tag_state(workspace_id,next_check_at);

-- Header facts only. No mailbox credentials, bodies, or model-written summaries.
create table public.crm_tag_message_events (
  workspace_id uuid not null default crm_tenancy.workspace_id(),
  message_key text not null,
  company_id uuid not null,
  contact_email text not null,
  message_id text,
  conversation_keys text[] not null,
  direction text not null check(direction in ('inbound','outbound')),
  occurred_at timestamptz not null,
  automatic_response boolean not null default false,
  removed boolean not null default false,
  signature text not null,
  primary key (workspace_id,message_key),
  foreign key (workspace_id,company_id) references public.companies(workspace_id,id) on delete cascade
);
create index crm_tag_message_events_company on public.crm_tag_message_events(workspace_id,company_id,occurred_at);
create index crm_tag_message_events_keys on public.crm_tag_message_events using gin(conversation_keys);
create index contacts_customer_tag_lookup on public.contacts(workspace_id,lower(email::text));
create table public.crm_tag_runtime_state (
  workspace_id uuid primary key default crm_tenancy.workspace_id() references public.workspaces(id) on delete cascade,
  phase text not null default 'sent' check(phase in ('sent','emails','snapshots','done')),
  row_cursor uuid,
  snapshot_cursor text
);

do $$ declare tab text; begin
  foreach tab in array array['crm_customer_tag_state','crm_customer_tag_work','crm_tag_message_events','crm_tag_runtime_state'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from public,anon,authenticated',tab);
    execute format('grant select,insert,update,delete on public.%I to service_role,crm_workspace_server',tab);
    execute format('create policy crm_workspace_isolation on public.%I to crm_workspace_server using(workspace_id=(select crm_tenancy.workspace_id())) with check(workspace_id=(select crm_tenancy.workspace_id()))',tab);
  end loop;
end $$;

create function public.enqueue_customer_tag_work(p_company uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.companies where workspace_id=crm_tenancy.workspace_id() and id=p_company) then return; end if;
  insert into public.crm_customer_tag_work(workspace_id,company_id) values(crm_tenancy.workspace_id(),p_company)
  on conflict(workspace_id,company_id) do update set revision=crm_customer_tag_work.revision+1,
    next_attempt_at=now(),attempts=0,updated_at=now();
  insert into public.crm_customer_tag_state(workspace_id,company_id) values(crm_tenancy.workspace_id(),p_company)
  on conflict(workspace_id,company_id) do update set processing_status='pending',processing_reason=null;
end $$;

create function public.crm_tag_message_keys(p jsonb) returns text[]
language sql immutable security invoker set search_path='' as $$
  select coalesce(array_agg(distinct k order by k) filter(where length(k)<=512),'{}') from (
    select 'conversation:'||btrim(p->>'threadId') k where nullif(btrim(p->>'threadId'),'') is not null
    union all select 'conversation:'||v from jsonb_array_elements_text(case when jsonb_typeof(p->'tagThreadAliases')='array' then p->'tagThreadAliases' else '[]'::jsonb end) v
    union all select 'conversation:message:'||lower(btrim(v)) from (
      select p->>'messageId' v union all select p->>'inReplyTo'
      union all select jsonb_array_elements_text(case when jsonb_typeof(p->'references')='array' then p->'references' else '[]'::jsonb end)
    ) ids where nullif(btrim(v),'') is not null
  ) keys;
$$;

create function public.ingest_customer_tag_messages(p_messages jsonb) returns uuid[]
language plpgsql security invoker set search_path='' as $$
declare p jsonb; companies uuid[]; company uuid; old_company uuid; contact text; mid text; mkey text; keys text[];
  stamp timestamptz; sig text; changed uuid; affected uuid[]:='{}'; addresses text[]; dir text; tenant uuid:=crm_tenancy.workspace_id();
begin
  if jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages)>2500 then raise exception 'Invalid message metadata batch'; end if;
  for p in select value from jsonb_array_elements(p_messages) loop
    if coalesce(p->>'direction','') not in ('inbound','outbound') or p->>'providerKind' in ('drafts','trash','junk','spam') or p->>'status'='Provider draft' then continue; end if;
    dir:=case when exists(select 1 from public.workspace_mailboxes m where m.workspace_id=tenant and lower(p->>'from') in (lower(m.email),lower(m.imap_username))) then 'outbound' else p->>'direction' end;
    mid:=nullif(lower(btrim(p->>'messageId')),'');
    mkey:=coalesce('imap-'||mid,nullif(p->>'id',''));
    if mkey is null or length(mkey)>1024 then continue; end if;
    addresses:=array(select distinct lower(btrim(v)) from (
      select p->>'contact' v union all select p->>'from'
      union all select coalesce(x->>'address',trim(both '"' from x::text)) from jsonb_array_elements(case when jsonb_typeof(p->'to')='array' then p->'to' else '[]'::jsonb end) x
      union all select coalesce(x->>'address',trim(both '"' from x::text)) from jsonb_array_elements(case when jsonb_typeof(p->'cc')='array' then p->'cc' else '[]'::jsonb end) x
    ) a where nullif(btrim(v),'') is not null);
    select array_agg(distinct c.company_id),min(lower(c.email::text)) into companies,contact from public.contacts c
    where c.workspace_id=tenant and lower(c.email::text)=any(addresses)
      and not exists(select 1 from public.workspace_mailboxes m where m.workspace_id=tenant and lower(c.email::text) in (lower(m.email),lower(m.imap_username)));
    if coalesce(cardinality(companies),0)<>1 then
      delete from public.crm_tag_message_events where workspace_id=tenant and message_key=mkey returning company_id into old_company;
      if old_company is not null then affected:=array_append(affected,old_company); end if;
      continue;
    end if;
    company:=companies[1]; keys:=public.crm_tag_message_keys(p);
    -- RFC identity is immutable. Retain explicitly proven aliases across CRM,
    -- provider and workflow-origin copies instead of oscillating between them.
    select coalesce(array_agg(distinct k order by k),'{}') into keys from (
      select unnest(keys) k union all select unnest(e.conversation_keys) from public.crm_tag_message_events e
        where e.workspace_id=tenant and e.message_key=mkey and e.company_id=company
    ) aliases;
    if cardinality(keys)=0 then continue; end if;
    begin stamp:=(p->>'timestamp')::timestamptz; exception when others then continue; end;
    if stamp is null or stamp>now()+interval '1 day' then continue; end if;
    sig:=md5(jsonb_build_array(company,contact,mid,keys,dir,stamp,
      coalesce((p->>'automaticResponse')::boolean,false),coalesce((p->>'providerRemoved')::boolean,false))::text);
    select company_id into old_company from public.crm_tag_message_events where workspace_id=tenant and message_key=mkey;
    changed:=null;
    insert into public.crm_tag_message_events(workspace_id,message_key,company_id,contact_email,message_id,conversation_keys,direction,occurred_at,automatic_response,removed,signature)
    values(tenant,mkey,company,contact,mid,keys,dir,stamp,coalesce((p->>'automaticResponse')::boolean,false),coalesce((p->>'providerRemoved')::boolean,false),sig)
    on conflict(workspace_id,message_key) do update set company_id=excluded.company_id,contact_email=excluded.contact_email,
      message_id=excluded.message_id,conversation_keys=excluded.conversation_keys,direction=excluded.direction,
      occurred_at=excluded.occurred_at,automatic_response=excluded.automatic_response,removed=excluded.removed,signature=excluded.signature
    where crm_tag_message_events.signature<>excluded.signature returning company_id into changed;
    if changed is not null then affected:=array_append(affected,changed); end if;
    if changed is not null and old_company is distinct from changed and old_company is not null then affected:=array_append(affected,old_company); end if;
  end loop;
  return array(select distinct unnest(affected));
end $$;

create function public.refresh_customer_tag_rules(p_company uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare tenant uuid:=crm_tenancy.workspace_id(); tags text[]:='{}'; comm jsonb; f jsonb; active_orders integer; repeats integer;
  payments integer; commitments integer; quotes integer; inactivity_months integer; buyer_at timestamptz; purchase_at timestamptz; fresh boolean;
begin
  if not exists(select 1 from public.companies where workspace_id=tenant and id=p_company) then return; end if;
  -- One projection update per company at a time; source transactions already own
  -- their business rows. No email tags, orders or payments are rewritten here.
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||':tag:'||p_company::text,0));
  select count(*) filter(where document->>'status' in ('confirmed','in_production','shipped')),
    max(coalesce(updated_at,created_at)) filter(where document->>'status' not in ('draft','cancelled'))
    into active_orders,purchase_at from public.purchase_orders where workspace_id=tenant and company_id=p_company;
  select count(*) into repeats from public.purchase_orders o where o.workspace_id=tenant and o.company_id=p_company
    and o.document->>'status'='completed' and o.total_minor>0 and exists(
      select 1 from public.invoices i where i.workspace_id=tenant and i.purchase_order_id=o.id and i.status='issued'
      having sum(i.total_minor)>=o.total_minor and sum(i.paid_minor)>=sum(i.total_minor));
  select count(*) filter(where i.last_sent_at is not null),count(*) into payments,commitments from public.invoices i
    where i.workspace_id=tenant and i.company_id=p_company and i.status='issued' and i.total_minor>i.paid_minor
      and (i.purchase_order_id is null or exists(select 1 from public.purchase_orders o where o.workspace_id=tenant and o.id=i.purchase_order_id and o.document->>'status' not in ('draft','cancelled')));
  select count(*) into quotes from public.catalogs c where c.workspace_id=tenant and c.company_id=p_company
    and c.quote_status='shared' and c.quote_document is not null and c.quote_order_id is null
    and (c.quote_document->>'validUntil')::date>=(now() at time zone 'Asia/Shanghai')::date;
  if payments>0 then tags:=array_append(tags,'Payment Follow-up'); end if;
  if active_orders>0 then tags:=array_append(tags,'Orders in Fulfillment'); end if;
  if repeats>=2 then tags:=array_append(tags,'Repeat Customers'); end if;
  if quotes>0 then tags:=array_append(tags,'Quotation Follow-up'); end if;

  with origins as (
    select 'conversation:shopify:'||s.webhook_id origin_key,'shopify' kind,s.webhook_id origin_id,s.email::text email,s.created_at at
      from public.shopify_leads s where s.workspace_id=tenant and s.company_id=p_company and s.status='processed'
    union all select 'conversation:meta-lead:'||m.leadgen_id,'meta',m.leadgen_id,m.email::text,m.created_at
      from public.meta_leads m where m.workspace_id=tenant and m.company_id=p_company and m.email is not null
    union all select t.message_key,'email',t.message_key,t.contact_email,t.updated_at from public.crm_email_tags t
      where t.workspace_id=tenant and t.company_id=p_company and t.tag='New Inquiries' and t.message_key like 'conversation:%'
      and t.message_key not like 'conversation:shopify:%' and t.message_key not like 'conversation:meta-lead:%'
  ), linked as (
    select o.*,array[o.origin_key]||coalesce(array(
      select distinct 'conversation:'||v from public.flow_runs r
      cross join lateral unnest(array[r.conversation_id,r.context->>'emailThreadId']) v
      join public.contacts ct on ct.workspace_id=r.workspace_id and ct.id=r.contact_id
      where r.workspace_id=tenant and r.company_id=p_company and lower(ct.email::text)=lower(o.email)
        and r.context#>>'{inquiryOrigin,id}'=o.origin_id
        and (r.context#>>'{inquiryOrigin,source}'=o.kind or o.kind='meta' and r.context#>>'{inquiryOrigin,source}'='meta-lead')
        and not exists(select 1 from public.flow_runs other where other.workspace_id=tenant and other.company_id=p_company
          and other.conversation_id=r.conversation_id and other.context#>>'{inquiryOrigin,id}' is not null
          and (other.context#>>'{inquiryOrigin,id}',other.context#>>'{inquiryOrigin,source}') is distinct from (r.context#>>'{inquiryOrigin,id}',r.context#>>'{inquiryOrigin,source}'))
        and nullif(v,'') is not null
    ),'{}') keys from origins o
  ), expanded as (
    select l.*,l.keys||array(select distinct unnest(e.conversation_keys) from public.crm_tag_message_events e
      where e.workspace_id=tenant and e.company_id=p_company and e.conversation_keys&&l.keys and not e.removed) all_keys from linked l
  ), progress as (
    select x.origin_key,x.all_keys,
      case when a.sent is null then 'new' when a.received>a.sent then 'replied' else 'contacted' end status
    from expanded x cross join lateral (
      select max(e.occurred_at) filter(where direction='outbound') sent,max(e.occurred_at) filter(where direction='inbound') received
      from public.crm_tag_message_events e where e.workspace_id=tenant and e.company_id=p_company
        and e.conversation_keys&&x.all_keys and not e.automatic_response and not e.removed
    ) a
  ) select coalesce(jsonb_agg(distinct jsonb_build_object('keys',all_keys,'status',status)),'[]') into comm from progress;
  if exists(select 1 from jsonb_array_elements(comm) c where c->>'status'='contacted'
    and not exists(select 1 from public.crm_email_tags t where t.workspace_id=tenant and t.company_id=p_company
      and t.source in ('manual','flow') and t.message_key in(select jsonb_array_elements_text(c->'keys')))) then tags:=array_append(tags,'Contacted — waiting for customer'); end if;
  if exists(select 1 from jsonb_array_elements(comm) c where c->>'status'='replied'
    and not exists(select 1 from public.crm_email_tags t where t.workspace_id=tenant and t.company_id=p_company
      and t.source in ('manual','flow') and t.message_key in(select jsonb_array_elements_text(c->'keys')))) then tags:=array_append(tags,'Customer replied'); end if;

  select min(greatest(1,least(24,(fl.trigger_config->>'inactivityMonths')::integer))) into inactivity_months
    from public.flows fl join public.pipeline p on p.workspace_id=fl.workspace_id and p.owner_id=fl.user_id
    where fl.workspace_id=tenant and p.company_id=p_company and fl.status='live' and fl.trigger_type='dormant_customer'
      and fl.trigger_config->>'inactivityMonths' ~ '^\d{1,2}$';
  select greatest(max(occurred_at),purchase_at) into buyer_at from public.crm_tag_message_events
    where workspace_id=tenant and company_id=p_company and direction='inbound' and not automatic_response and not removed;
  select exists(select 1 from public.workspace_mailboxes where workspace_id=tenant and is_active and nullif(imap_host,'') is not null)
    and not exists(select 1 from public.workspace_mailboxes m where m.workspace_id=tenant and m.is_active and nullif(m.imap_host,'') is not null
      and not exists(select 1 from public.mail_sync_accounts a join public.mail_sync_jobs j on j.workspace_id=a.workspace_id and j.account_key=a.account_key
        where a.workspace_id=tenant and a.mailbox_id=m.id and j.kind='inbox' and j.last_success_at>now()-interval '1 day')) into fresh;
  if inactivity_months is not null and fresh and buyer_at is not null and buyer_at<=now()-make_interval(months=>inactivity_months)
    and active_orders=0 and commitments=0 and quotes=0
    and not exists(select 1 from public.pipeline where workspace_id=tenant and company_id=p_company and next_followup_at>now())
    and not exists(select 1 from public.email_auto_replies ar join public.contacts ct on ct.workspace_id=ar.workspace_id and lower(ct.email::text)=lower(ar.recipient)
      where ar.workspace_id=tenant and ct.company_id=p_company and ar.enabled)
    and not exists(select 1 from public.email_message_followups ar join public.contacts ct on ct.workspace_id=ar.workspace_id and lower(ct.email::text)=lower(ar.recipient)
      where ar.workspace_id=tenant and ct.company_id=p_company and ar.status in ('scheduled','processing','uncertain')) then tags:=array_append(tags,'Inactive Customers'); end if;
  f:=jsonb_build_object('version','rules-v1','activeOrders',active_orders,'completedSettledPurchases',repeats,'outstandingCommunicatedInvoices',payments,
    'unresolvedInvoices',commitments,'sharedQuotes',quotes,'lastBuyerActivityAt',buyer_at,'inactivityMonths',inactivity_months,'mailCoverageFresh',fresh);
  insert into public.crm_customer_tag_state(workspace_id,company_id,tags,communication,facts,checked_at,next_check_at,processing_status)
    values(tenant,p_company,tags,comm,f,now(),date_trunc('day',now())+interval '1 day','pending')
    on conflict(workspace_id,company_id) do update set tags=excluded.tags,communication=excluded.communication,facts=excluded.facts,
      checked_at=now(),next_check_at=excluded.next_check_at;
end $$;

create function public.record_customer_tag_messages(p_messages jsonb) returns integer
language plpgsql security invoker set search_path='' as $$ declare company uuid; n integer:=0; begin
  foreach company in array public.ingest_customer_tag_messages(p_messages) loop
    perform public.enqueue_customer_tag_work(company); perform public.refresh_customer_tag_rules(company); n:=n+1;
  end loop;
  return n;
end $$;

-- Header reconciliation runs independently of AI permissions, with durable
-- cursors and no provider requests. New source writes are already trigger-fed.
create function public.seed_customer_tag_messages(p_limit integer default 500) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.crm_tag_runtime_state; tenant uuid:=crm_tenancy.workspace_id(); batch jsonb; last_id uuid; snapshot record; chunk jsonb;
  n integer:=0; pos integer; lim integer:=greatest(1,least(p_limit,1000));
begin
  insert into public.crm_tag_runtime_state(workspace_id) values(tenant) on conflict do nothing;
  select * into s from public.crm_tag_runtime_state where workspace_id=tenant for update;
  if s.phase='done' then return jsonb_build_object('done',true,'processed',0); end if;
  if s.phase='sent' then
    with selected as(select * from public.mailbox_sent_messages where workspace_id=tenant and status='sent' and (s.row_cursor is null or id>s.row_cursor) order by id limit lim)
    select coalesce(jsonb_agg(jsonb_build_object('id','sent-'||id,'messageId',message_id,'threadId',thread_key,'inReplyTo',in_reply_to,'references',reference_ids,
      'direction','outbound','contact',to_email::text,'from',from_email::text,'timestamp',sent_at,'status',status)),'[]'),(array_agg(id order by id desc))[1] into batch,last_id from selected;
    n:=jsonb_array_length(batch); if n>0 then perform public.record_customer_tag_messages(batch); end if;
    update public.crm_tag_runtime_state set phase=case when n<lim then 'emails' else 'sent' end,row_cursor=case when n<lim then null else last_id end where workspace_id=tenant;
  elsif s.phase='emails' then
    with selected as(select e.*,ct.email::text contact_email from public.emails e join public.contacts ct on ct.workspace_id=e.workspace_id and ct.id=e.contact_id
      where e.workspace_id=tenant and (s.row_cursor is null or e.id>s.row_cursor) order by e.id limit lim)
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'messageId',message_id,'threadId',thread_id,'direction',case when direction='received' then 'inbound' else 'outbound' end,
      'contact',contact_email,'timestamp',coalesce(sent_at,created_at),'status',case when status in ('sent','received') then status else 'Provider draft' end,'automaticResponse',automatic_response)),'[]'),
      (array_agg(id order by id desc))[1] into batch,last_id from selected;
    n:=jsonb_array_length(batch); if n>0 then perform public.record_customer_tag_messages(batch); end if;
    update public.crm_tag_runtime_state set phase=case when n<lim then 'snapshots' else 'emails' end,row_cursor=case when n<lim then null else last_id end where workspace_id=tenant;
  else
    select mailbox_key,messages into snapshot from public.mailbox_sync_state where workspace_id=tenant
      and (s.snapshot_cursor is null or mailbox_key>s.snapshot_cursor) order by mailbox_key limit 1;
    if not found then update public.crm_tag_runtime_state set phase='done' where workspace_id=tenant; return jsonb_build_object('done',true,'processed',0); end if;
    n:=jsonb_array_length(coalesce(snapshot.messages,'[]'));
    for pos in 0..(n/lim) loop
      select coalesce(jsonb_agg(value),'[]') into chunk from jsonb_array_elements(coalesce(snapshot.messages,'[]')) with ordinality m(value,idx)
        where idx>pos*lim and idx<=(pos+1)*lim;
      if jsonb_array_length(chunk)>0 then perform public.record_customer_tag_messages(chunk); end if;
    end loop;
    update public.crm_tag_runtime_state set snapshot_cursor=snapshot.mailbox_key where workspace_id=tenant;
  end if;
  return jsonb_build_object('done',false,'processed',n);
end $$;

create function public.crm_tag_header(p jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select jsonb_build_array(p->'id',p->'messageId',p->'threadId',p->'inReplyTo',p->'references',p->'direction',p->'contact',
    p->'from',p->'to',p->'cc',p->'timestamp',p->'automaticResponse',p->'providerRemoved',p->'providerKind');
$$;
create function public.customer_tag_snapshot_changed() returns trigger
language plpgsql security invoker set search_path='' as $$ declare delta jsonb; chunk jsonb; n integer; begin
  if new.messages is not distinct from old.messages then return null; end if;
  with before as (
    select coalesce(value->>'messageId',value->>'id') id,public.crm_tag_header(value) header
      from jsonb_array_elements(coalesce(old.messages,'[]'))
  ) select coalesce(jsonb_agg(n.value),'[]') into delta from jsonb_array_elements(coalesce(new.messages,'[]')) n
    where not exists(select 1 from before b where b.id=coalesce(n.value->>'messageId',n.value->>'id') and b.header=public.crm_tag_header(n.value));
  -- Imported history can arrive in large batches; the public metadata API stays bounded.
  for n in 0..(jsonb_array_length(delta)/500) loop
    select coalesce(jsonb_agg(value),'[]') into chunk from jsonb_array_elements(delta) with ordinality p(value,pos) where pos>n*500 and pos<=(n+1)*500;
    if jsonb_array_length(chunk)>0 then perform public.record_customer_tag_messages(chunk); end if;
  end loop; return null;
end $$;
create trigger customer_tag_snapshot_changed after update of messages on public.mailbox_sync_state
  for each row execute function public.customer_tag_snapshot_changed();

create function public.customer_tag_source_changed() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; company uuid; affected uuid; ids uuid[]; meta jsonb;
begin
  if tg_table_name='flow_runs' and tg_op='UPDATE' and to_jsonb(old)#>'{context,inquiryOrigin}' is not distinct from r#>'{context,inquiryOrigin}'
    and to_jsonb(old)#>'{context,emailThreadId}' is not distinct from r#>'{context,emailThreadId}' then return null; end if;
  if tg_table_name='workspace_ai_settings' then
    for company in select id from public.companies where workspace_id=crm_tenancy.workspace_id() order by id loop
      perform public.enqueue_customer_tag_work(company);
    end loop; return null;
  elsif tg_table_name='flows' then
    if r->>'trigger_type'='dormant_customer' or to_jsonb(old)->>'trigger_type'='dormant_customer' then
      for company in select company_id from public.pipeline where workspace_id=crm_tenancy.workspace_id() and owner_id=(r->>'user_id')::uuid order by company_id loop
        perform public.refresh_customer_tag_rules(company);
      end loop;
    end if; return null;
  end if;
  if tg_table_name='mailbox_sent_messages' then
    if r->>'status'<>'sent' then return null; end if;
    meta:=jsonb_build_object('id','sent-'||(r->>'id'),'messageId',r->>'message_id','threadId',r->>'thread_key','inReplyTo',r->>'in_reply_to',
      'references',r->'reference_ids','direction','outbound','contact',r->>'to_email','from',r->>'from_email','timestamp',r->>'sent_at','providerRemoved',tg_op='DELETE');
    perform public.record_customer_tag_messages(jsonb_build_array(meta)); return null;
  elsif tg_table_name='emails' then
    if r->>'status' not in ('sent','received') then return null; end if;
    select company_id into company from public.contacts where workspace_id=crm_tenancy.workspace_id() and id=(r->>'contact_id')::uuid;
    select jsonb_build_object('id',r->>'id','messageId',r->>'message_id','threadId',r->>'thread_id','direction',case when r->>'direction'='received' then 'inbound' else 'outbound' end,
      'contact',email::text,'timestamp',coalesce(r->>'sent_at',r->>'created_at'),'automaticResponse',r->'automatic_response','providerRemoved',tg_op='DELETE') into meta
      from public.contacts where workspace_id=crm_tenancy.workspace_id() and id=(r->>'contact_id')::uuid;
    if meta is not null then perform public.record_customer_tag_messages(jsonb_build_array(meta)); end if; return null;
  elsif tg_table_name='invoice_payments' then
    select company_id into company from public.invoices where workspace_id=crm_tenancy.workspace_id() and id=(r->>'invoice_id')::uuid;
  elsif tg_table_name='contacts' then company:=(r->>'company_id')::uuid;
  else company:=nullif(r->>'company_id','')::uuid;
  end if;
  if company is not null then
    if tg_table_name in ('shopify_leads','meta_leads','contacts') then perform public.enqueue_customer_tag_work(company); end if;
    perform public.refresh_customer_tag_rules(company);
  end if;
  if tg_op='UPDATE' and to_jsonb(old)->>'company_id' is distinct from r->>'company_id' then
    affected:=nullif(to_jsonb(old)->>'company_id','')::uuid;
    if affected is not null then perform public.enqueue_customer_tag_work(affected); perform public.refresh_customer_tag_rules(affected); end if;
  end if;
  return null;
end $$;

do $$ declare tab text; begin
  foreach tab in array array['purchase_orders','invoices','invoice_payments','catalogs','shopify_leads','meta_leads','contacts','mailbox_sent_messages','emails','crm_email_tags','flow_runs','pipeline','flows','workspace_ai_settings'] loop
    execute format('create trigger customer_tag_facts_changed after insert or update or delete on public.%I for each row execute function public.customer_tag_source_changed()',tab);
  end loop;
end $$;

create function public.claim_customer_tag_work(p_token uuid,p_limit integer default 8,p_companies uuid[] default null)
returns table(company_id uuid,revision bigint) language sql security invoker set search_path='' as $$
  with due as (
    select w.company_id from public.crm_customer_tag_work w where w.workspace_id=crm_tenancy.workspace_id()
      and w.revision>w.processed_revision and w.next_attempt_at<=now() and (w.lease_until is null or w.lease_until<=now())
      and (p_companies is null or w.company_id=any(p_companies)) order by w.updated_at limit greatest(1,least(p_limit,32)) for update skip locked
  ) update public.crm_customer_tag_work w set lease_token=p_token,lease_until=now()+interval '4 minutes',attempts=w.attempts+1
    from due where w.workspace_id=crm_tenancy.workspace_id() and w.company_id=due.company_id returning w.company_id,w.revision;
$$;
create function public.finish_customer_tag_work(p_company uuid,p_token uuid,p_revision bigint,p_status text,p_reason text default null)
returns boolean language plpgsql security invoker set search_path='' as $$ declare changed uuid; begin
  if p_status not in ('current','pending','waiting_history','needs_review','retrying','paused') then raise exception 'Invalid tag processing status'; end if;
  update public.crm_customer_tag_work w set
    processed_revision=case when p_status in ('current','needs_review','waiting_history') then p_revision else w.processed_revision end,
    next_attempt_at=now()+case when p_status='pending' then interval '1 minute' when p_status='paused' then interval '15 minutes'
      when w.attempts<=1 then interval '1 minute' when w.attempts=2 then interval '5 minutes' else interval '1 hour' end,
    lease_token=null,lease_until=null
    where w.workspace_id=crm_tenancy.workspace_id() and w.company_id=p_company and w.lease_token=p_token and w.lease_until>now() and w.revision=p_revision
    returning w.company_id into changed;
  if changed is null then
    -- New input during analysis remains queued and immediately reclaimable.
    update public.crm_customer_tag_work set lease_token=null,lease_until=null where workspace_id=crm_tenancy.workspace_id() and company_id=p_company and lease_token=p_token;
    return false;
  end if;
  update public.crm_customer_tag_state set processing_status=p_status,processing_reason=left(p_reason,240)
    where workspace_id=crm_tenancy.workspace_id() and company_id=p_company;
  return true;
end $$;
create function public.refresh_due_customer_tag_rules(p_limit integer default 100) returns integer
language plpgsql security invoker set search_path='' as $$ declare company uuid; n integer:=0; begin
  for company in select company_id from public.crm_customer_tag_state where workspace_id=crm_tenancy.workspace_id() and next_check_at<=now()
    order by next_check_at limit greatest(1,least(p_limit,200)) loop
    perform public.refresh_customer_tag_rules(company); n:=n+1;
  end loop; return n;
end $$;

-- Contacted/replied are separate communication facts, also selectable manually.
alter table public.crm_email_tags drop constraint crm_email_tags_tag_check;
alter table public.crm_email_tags add constraint crm_email_tags_tag_check check(tag in (
  'Prospect Nurturing','New Inquiries','Quotation Follow-up','Active Negotiations','Payment Follow-up',
  'Orders in Fulfillment','Repeat Customers','Inactive Customers','Contacted — waiting for customer','Customer replied'));

alter table public.crm_conversation_tag_analysis drop constraint crm_conversation_tag_analysis_status_check;
alter table public.crm_conversation_tag_analysis add constraint crm_conversation_tag_analysis_status_check
  check(status in ('processing','done','failed','manual','review','waiting_history'));
create function public.finish_conversation_tag_analysis_v2(
  p_key text,p_token uuid,p_keys text[],p_message_keys text[],p_contact text,p_tag text,p_confidence numeric,
  p_reason text,p_evidence jsonb,p_error boolean,p_metrics jsonb,p_action text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare completed boolean; job public.crm_conversation_tag_analysis; target text; company uuid;
begin
  if p_action not in ('apply','keep','clear','review','waiting_history') then raise exception 'Invalid conversation decision'; end if;
  -- Serialize the short commit against new source events and policy changes.
  -- A company revision fence is independent from the conversation's input lease.
  perform 1 from public.crm_customer_tag_work where workspace_id=crm_tenancy.workspace_id()
    and company_id=(p_metrics->>'companyId')::uuid and revision=(p_metrics->>'workRevision')::bigint
    and lease_token=(p_metrics->>'workToken')::uuid and lease_until>now() for update;
  if not found then
    update public.crm_conversation_tag_analysis set status='failed',lease_token=null,lease_until=null,retry_at=now()
      where workspace_id=crm_tenancy.workspace_id() and conversation_key=p_key and lease_token=p_token;
    return false;
  end if;
  if p_action='apply' and p_tag in ('Payment Follow-up','Orders in Fulfillment','Repeat Customers','Contacted — waiting for customer','Customer replied') then
    raise exception 'This fact is owned by CRM rules';
  end if;
  if p_action in ('apply','clear') and (p_confidence<case when p_action='clear' then 0.9 else 0.85 end
    or jsonb_typeof(p_evidence)<>'array' or jsonb_array_length(p_evidence)=0) then raise exception 'Evidence is required'; end if;
  completed:=public.finish_conversation_tag_analysis_with_metrics(p_key,p_token,p_keys,p_message_keys,p_contact,
    case when p_action='apply' then p_tag else null end,p_confidence,p_reason,p_evidence,p_error,p_metrics);
  if not completed then return false; end if;
  select * into job from public.crm_conversation_tag_analysis where workspace_id=crm_tenancy.workspace_id() and conversation_key=p_key;
  if job.status='manual' or p_error or job.status='failed' then return true; end if;
  if p_action='clear' then
    -- The existing finisher already serialized manual edits and checked policy.
    select company_id into company from public.contacts where workspace_id=crm_tenancy.workspace_id() and lower(email::text)=lower(p_contact)
      group by company_id having count(*)=1;
    if company is null then raise exception 'Unambiguous customer required'; end if;
    for target in select distinct unnest(p_keys||p_message_keys) loop
      insert into public.crm_email_tags(workspace_id,message_key,company_id,contact_email,tag,source,updated_at)
      values(crm_tenancy.workspace_id(),target,company,lower(p_contact),null,'ai',now())
      on conflict(workspace_id,message_key) do update set tag=null,source='ai',updated_at=now();
    end loop;
  end if;
  update public.crm_conversation_tag_analysis set status=case p_action when 'review' then 'review' when 'waiting_history' then 'waiting_history' else 'done' end
    where workspace_id=crm_tenancy.workspace_id() and conversation_key=p_key;
  return true;
end $$;

-- Add only the explicitly evaluated escalation model to the existing allowance guard.
do $$ declare definition text; begin
  select pg_get_functiondef(oid) into definition from pg_proc where pronamespace='public'::regnamespace and proname='reserve_ai_budget';
  if definition is null then raise exception 'AI budget setup is required'; end if;
  execute replace(definition,'''anthropic/claude-haiku-5.5''','''anthropic/claude-haiku-5.5'',''openai/gpt-6.2-sol''');
end $$;

-- Durable empty jobs seed the existing workspace without changing any saved
-- manual/conversation assignment. The deployed worker hydrates header facts.
insert into public.crm_customer_tag_state(workspace_id,company_id) select workspace_id,id from public.companies on conflict do nothing;
insert into public.crm_customer_tag_work(workspace_id,company_id) select workspace_id,id from public.companies on conflict do nothing;

do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (
    'enqueue_customer_tag_work','crm_tag_message_keys','ingest_customer_tag_messages','refresh_customer_tag_rules','record_customer_tag_messages',
    'customer_tag_source_changed','claim_customer_tag_work','finish_customer_tag_work','refresh_due_customer_tag_rules',
    'crm_tag_header','customer_tag_snapshot_changed','finish_conversation_tag_analysis_v2','seed_customer_tag_messages') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role,crm_workspace_server',f.signature);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
