-- Exercise the actual rules and durable outbox without committing any fixture.
begin;
set local statement_timeout='90s';
do $$
declare company uuid:=gen_random_uuid(); contact uuid:=gen_random_uuid(); actor uuid; mailbox uuid;
  address text:='tag-rules-'||gen_random_uuid()||'@example.invalid'; lead text:='qa-tag-rules-'||gen_random_uuid();
  origin text; mid text:='<tag-rules-'||gen_random_uuid()||'@example.invalid>'; revision bigint; version bigint;
  token uuid:=gen_random_uuid(); other_token uuid:=gen_random_uuid(); metadata jsonb; snapshot jsonb;
begin
  select owner_id into actor from public.workspaces where is_legacy;
  insert into public.companies(id,name,source) values(company,'Tag architecture QA DO NOT CONTACT','sample_seed');
  insert into public.contacts(id,company_id,email) values(contact,company,address);
  insert into public.shopify_leads(webhook_id,shop_domain,customer_id,email,company_name,status,company_id,contact_id)
    values(lead,'qa.example.invalid','form:'||lead,address,'Tag architecture QA','processed',company,contact);
  origin:='shopify:'||lead;
  assert exists(select 1 from public.crm_email_tags where company_id=company and tag='New Inquiries' and source='rule'), 'Verified intake preserves its original assignment';
  update public.workspace_ai_settings set policy=jsonb_set(policy,'{enabled}','false') where singleton;
  insert into public.mailbox_sent_messages(user_id,from_email,to_email,subject,body,status,thread_key,message_id,sent_at)
    values(actor,'qa-staff@example.invalid',address,'QA reply','Which colors do you need?','sent',origin,mid,now()-interval '1 minute');
  assert exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Contacted — waiting for customer'=any(tags)), 'Contacted works with AI disabled';
  assert exists(select 1 from public.crm_email_tags where company_id=company and tag='New Inquiries'), 'Rules do not destroy conversation history';
  insert into public.emails(contact_id,direction,status,thread_id,message_id,body,automatic_response,created_at)
    values(contact,'received','received',origin,'<qa-buyer-'||contact||'@example.invalid>','Please quote 100 kg.',false,now());
  assert exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Customer replied'=any(tags) and not 'Contacted — waiting for customer'=any(tags)), 'Later buyer reply changes communication status';

  metadata:=jsonb_build_array(jsonb_build_object('id','qa-copy','messageId',mid,'threadId',origin,'direction','outbound','contact',address,'timestamp',now()-interval '1 minute'));
  perform public.record_customer_tag_messages(metadata);
  select w.revision into revision from public.crm_customer_tag_work w where company_id=company;
  perform public.record_customer_tag_messages(jsonb_set(metadata,'{0,read}','true'));
  assert (select w.revision from public.crm_customer_tag_work w where company_id=company)=revision, 'Read flags and repeated copies do not enqueue paid work';
  select w.revision into version from public.claim_customer_tag_work(token,1,array[company]) w;
  assert version is not null, 'Changed company can be leased';
  assert not exists(select 1 from public.claim_customer_tag_work(other_token,1,array[company])), 'Competing workers cannot take an active lease';
  perform public.enqueue_customer_tag_work(company);
  assert not public.finish_customer_tag_work(company,token,version,'current'), 'New input fences out stale completion';
  assert (select w.processed_revision<w.revision from public.crm_customer_tag_work w where company_id=company), 'Latest input remains queued';
  select w.revision into version from public.claim_customer_tag_work(other_token,1,array[company]) w;
  assert public.finish_customer_tag_work(company,other_token,version,'needs_review','Ambiguous evidence'), 'Review is a distinct durable outcome';
  assert exists(select 1 from public.crm_customer_tag_state where company_id=company and processing_status='needs_review'), 'Review must not display current';
  assert not exists(select 1 from public.claim_customer_tag_work(token,1,array[company])), 'Unchanged review does not purchase repeated analyses';

  -- A provider snapshot queues a newly imported reply, but preview/read changes do not.
  snapshot:=jsonb_build_array(jsonb_build_object('id','provider-qa','messageId','<snapshot-'||contact||'@example.invalid>',
    'threadId',origin,'direction','inbound','contact',address,'timestamp',now(),'bodyLoaded',false));
  insert into public.mailbox_sync_state(mailbox_key,messages) values('qa-tags-'||company,'[]');
  update public.mailbox_sync_state set messages=snapshot where mailbox_key='qa-tags-'||company;
  select w.revision into revision from public.crm_customer_tag_work w where company_id=company;
  update public.mailbox_sync_state set messages=jsonb_set(jsonb_set(snapshot,'{0,preview}','"Hydrated preview"'),'{0,read}','true') where mailbox_key='qa-tags-'||company;
  assert (select w.revision from public.crm_customer_tag_work w where company_id=company)=revision, 'Preview enrichment does not invalidate semantic input';
  assert not has_table_privilege('authenticated','public.crm_tag_message_events','SELECT'), 'Browser cannot inspect private header facts';
  assert not has_function_privilege('anon','public.record_customer_tag_messages(jsonb)','EXECUTE'), 'Anonymous caller cannot forge metadata';
  assert not exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Inactive Customers'=any(tags)), 'Inactivity thresholds must not be invented';
end $$;
do $$
declare company uuid:=gen_random_uuid(); actor uuid; inv public.invoices; po uuid; n integer; quote uuid; ref text;
  doc jsonb:=jsonb_build_object('sellerName','QA seller','sellerAddress','','sellerTaxId','','customerName','QA buyer',
    'customerEmail','','customerAddress','','customerTaxId','','currency','USD','issueDate',current_date,'dueDate',current_date+7,
    'reference','QA','notes','','paymentInstructions','','discountMinor',0,'shippingMinor',0,
    'items',jsonb_build_array(jsonb_build_object('description','PLA','quantity',1,'unitPriceMinor',1000,'taxBps',0)));
begin
  select owner_id into actor from public.workspaces where is_legacy;
  insert into public.companies(id,name,source) values(company,'Commercial tag QA DO NOT CONTACT','sample_seed');
  doc:=doc||jsonb_build_object('companyId',company);
  ref:='QA-RULE-'||gen_random_uuid();
  insert into public.purchase_orders(company_id,reference,total_minor,document,created_by)
    values(company,ref,1000,jsonb_build_object('reference',ref,'status','draft','currency','USD','orderDate',current_date,
      'deliveryDate','','shippingAddress','QA','items',jsonb_build_array(jsonb_build_object('description','PLA','sku','QA','quantity',1,'unitPriceMinor',1000))),actor)
    returning id into po;
  update public.purchase_orders set version=version+1,document=jsonb_set(document,'{status}','"confirmed"') where id=po;
  select * into strict inv from public.invoices where purchase_order_id=po and status='draft' and order_managed;
  assert not exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Payment Follow-up'=any(tags)), 'Draft invoices are not payment follow-up';
  perform public.mutate_invoice(inv.id,actor,jsonb_build_object('action','issue','revision',inv.revision));
  assert not exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Payment Follow-up'=any(tags)), 'Issuing is not proof of communication';
  update public.invoices set last_sent_at=now() where id=inv.id;
  assert exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Payment Follow-up'=any(tags)), 'Communicated outstanding invoice creates payment state';
  perform public.mutate_invoice(inv.id,actor,jsonb_build_object('action','payment','payment',jsonb_build_object('id',gen_random_uuid(),'amountMinor',400,'paidOn',current_date,'method','bank_transfer','reference','rollback QA')));
  assert exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Payment Follow-up'=any(tags)), 'Partial payment retains remaining balance';
  perform public.mutate_invoice(inv.id,actor,jsonb_build_object('action','payment','payment',jsonb_build_object('id',gen_random_uuid(),'amountMinor',600,'paidOn',current_date,'method','bank_transfer','reference','rollback QA')));
  assert not exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Payment Follow-up'=any(tags)), 'Full settlement retires payment follow-up';
  update public.purchase_orders set version=version+1,document=jsonb_set(document,'{status}','"completed"') where id=po;
  assert not exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Repeat Customers'=any(tags)), 'One completed purchase is not repeat business';

  for n in 2..2 loop
    ref:='QA-RULE-'||gen_random_uuid();
    insert into public.purchase_orders(company_id,reference,total_minor,document,created_by)
      values(company,ref,1000,jsonb_build_object('reference',ref,'status','draft','currency','USD','orderDate',current_date,
        'deliveryDate','','shippingAddress','QA','items',jsonb_build_array(jsonb_build_object('description','PLA','sku','QA','quantity',1,'unitPriceMinor',1000))),actor)
      returning id into po;
    assert not exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Orders in Fulfillment'=any(tags)), 'A draft order is not fulfillment';
    update public.purchase_orders set version=version+1,document=jsonb_set(document,'{status}','"confirmed"') where id=po;
    assert exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Orders in Fulfillment'=any(tags)), 'Confirmed active order creates fulfillment state';
    select * into strict inv from public.invoices where purchase_order_id=po and status='draft' and order_managed;
    perform public.mutate_invoice(inv.id,actor,jsonb_build_object('action','issue','revision',inv.revision));
    perform public.mutate_invoice(inv.id,actor,jsonb_build_object('action','payment','payment',jsonb_build_object('id',gen_random_uuid(),'amountMinor',inv.total_minor,'paidOn',current_date,'method','bank_transfer','reference','rollback QA')));
    update public.purchase_orders set version=version+1,document=jsonb_set(document,'{status}','"completed"') where id=po;
    assert not exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Orders in Fulfillment'=any(tags)), 'Completion retires active fulfillment';
    if n=1 then assert not exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Repeat Customers'=any(tags)), 'One purchase is not a repeat customer'; end if;
  end loop;
  assert exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Repeat Customers'=any(tags)), 'Two distinct completed settled purchases create repeat status';
  assert (select (facts->>'completedSettledPurchases')::int from public.crm_customer_tag_state where company_id=company)=2, 'Separate invoice payments do not count as purchases';
  insert into public.catalogs(user_id,company_id,product_skus,product_snapshot,currency,price_date,version,quote_status,quote_document)
    values(actor,company,'{}','[]','USD',current_date,1,'shared',jsonb_build_object('reference','QA-QUOTE','issueDate',current_date,'validUntil',current_date+7)) returning id into quote;
  assert exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Quotation Follow-up'=any(tags)), 'Valid recorded shared quotation creates follow-up';
  update public.catalogs set quote_status='accepted' where id=quote;
  assert not exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Quotation Follow-up'=any(tags)), 'Accepted quotation is no longer waiting for acceptance';
end $$;
do $$
declare company uuid:=gen_random_uuid(); contact uuid:=gen_random_uuid(); actor uuid; flow uuid; address text:='dormant-rule-'||gen_random_uuid()||'@example.invalid';
begin
  select owner_id into actor from public.workspaces where is_legacy;
  insert into public.companies(id,name,source) values(company,'Inactivity rules QA DO NOT CONTACT','sample_seed');
  insert into public.contacts(id,company_id,email) values(contact,company,address);
  insert into public.pipeline(company_id,owner_id) values(company,actor) on conflict(workspace_id,company_id) do update set owner_id=actor;
  insert into public.flows(user_id,name,trigger_type,trigger_config,status,created_by)
    values(actor,'QA inactivity policy','dormant_customer','{"inactivityMonths":1}','live',actor) returning id into flow;
  -- Fresh receiving coverage is a prerequisite, not guessed from old message dates.
  update public.mail_sync_jobs set last_success_at=now() where kind='inbox';
  perform public.record_customer_tag_messages(jsonb_build_array(jsonb_build_object('id','dormant-'||company,'messageId','<dormant-'||company||'@example.invalid>',
    'direction','inbound','contact',address,'timestamp',now()-interval '2 months')));
  if (select (facts->>'mailCoverageFresh')::boolean from public.crm_customer_tag_state where company_id=company) then
    assert exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Inactive Customers'=any(tags)), 'Configured inactivity uses buyer history';
    perform public.record_customer_tag_messages(jsonb_build_array(jsonb_build_object('id','outreach-'||company,'messageId','<outreach-'||company||'@example.invalid>',
      'direction','outbound','contact',address,'timestamp',now())));
    assert exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Inactive Customers'=any(tags)), 'Staff outreach does not reset buyer inactivity';
    update public.pipeline set next_followup_at=now()+interval '7 days' where company_id=company;
    assert not exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Inactive Customers'=any(tags)), 'Future agreed follow-up prevents premature inactive work';
    update public.pipeline set next_followup_at=null where company_id=company;
    perform public.record_customer_tag_messages(jsonb_build_array(jsonb_build_object('id','reactivated-'||company,'messageId','<reactivated-'||company||'@example.invalid>',
      'direction','inbound','contact',address,'timestamp',now())));
    assert not exists(select 1 from public.crm_customer_tag_state where company_id=company and 'Inactive Customers'=any(tags)), 'Buyer reactivation retires inactivity';
  end if;
end $$;
do $$
declare company uuid:=gen_random_uuid(); contact uuid:=gen_random_uuid(); address text:='decision-'||gen_random_uuid()||'@example.invalid';
  company_token uuid:=gen_random_uuid(); conversation_token uuid:=gen_random_uuid(); revision bigint; key text:='conversation:decision-'||gen_random_uuid();
  metrics jsonb; evidence jsonb:='[{"messageKey":"qa-cancellation","quote":"Please cancel this inquiry."}]';
begin
  insert into public.companies(id,name,source) values(company,'Decision fence QA DO NOT CONTACT','sample_seed');
  insert into public.contacts(id,company_id,email) values(contact,company,address);
  update public.workspace_ai_settings set policy=policy||'{"enabled":true,"features":{"automation":true,"email":true},"data":{"emails":true,"customers":true},"actions":{"tagging":"auto"}}' where singleton;
  insert into public.crm_email_tags(message_key,company_id,contact_email,tag,source,updated_at) values(key,company,address,'Active Negotiations','ai',now()-interval '1 day');
  select w.revision into revision from public.claim_customer_tag_work(company_token,1,array[company]) w;
  assert public.claim_conversation_tag_analysis(key,'decision-fixture',now(),1,conversation_token), 'Conversation claim succeeds';
  metrics:=jsonb_build_object('companyId',company,'workToken',company_token,'workRevision',revision);
  begin
    perform public.finish_conversation_tag_analysis_v2(key,conversation_token,array[key],'{}',address,'Payment Follow-up',0.99,'Unverified payment',evidence,false,metrics,'apply');
    raise exception 'Model-owned payment accepted';
  exception when raise_exception then
    if sqlerrm<>'This fact is owned by CRM rules' then raise; end if;
  end;
  assert public.finish_conversation_tag_analysis_v2(key,conversation_token,array[key],'{}',address,null,0.99,'Buyer cancelled',evidence,false,metrics,'clear'), 'Validated clear commits';
  assert exists(select 1 from public.crm_email_tags where message_key=key and tag is null), 'Clear retires the old semantic situation';
  update public.crm_conversation_tag_analysis set checked_at=now()-interval '1 day' where conversation_key=key;
  assert public.claim_conversation_tag_analysis(key,'next-decision',now(),2,conversation_token), 'New conversation input can be claimed';
  perform public.enqueue_customer_tag_work(company);
  assert not public.finish_conversation_tag_analysis_v2(key,conversation_token,array[key],'{}',address,'New Inquiries',0.99,'Stale output',evidence,false,metrics,'apply'), 'Source revision fences the model write itself';
  assert exists(select 1 from public.crm_email_tags where message_key=key and tag is null), 'Stale result never changes current situation';
end $$;

do $$
declare original uuid:=crm_tenancy.workspace_id(); other uuid; fixture uuid:=gen_random_uuid();
begin
  select id into other from public.workspaces where id<>original limit 1;
  assert other is not null, 'A second workspace is available for RLS validation';
  insert into public.companies(id,name,source) values(fixture,'Tenant tag QA DO NOT CONTACT','sample_seed');
  perform public.enqueue_customer_tag_work(fixture);
  perform set_config('crm.workspace_id',other::text,true);
  perform set_config('role','crm_workspace_server',true);
  assert not exists(select 1 from public.crm_customer_tag_work where company_id=fixture), 'Work queue is tenant isolated';
  assert not exists(select 1 from public.crm_customer_tag_state where company_id=fixture), 'Derived state is tenant isolated';
  assert not exists(select 1 from public.claim_customer_tag_work(gen_random_uuid(),1,array[fixture])), 'Other tenant cannot claim work';
  perform set_config('role','postgres',true);
  perform set_config('crm.workspace_id',original::text,true);
end $$;
select 'Communication, commercial rules, idempotency, fenced decisions, review and tenant isolation passed' result;
rollback;
