begin;
do $$
declare
  company uuid := gen_random_uuid(); contact uuid := gen_random_uuid(); token uuid := gen_random_uuid();
  shopify_id text := 'qa-rule-' || gen_random_uuid()::text; meta_id text := 'qa-rule-' || gen_random_uuid()::text;
  delayed_meta_id text := 'qa-rule-delayed-' || gen_random_uuid()::text;
  email text := 'qa-' || gen_random_uuid()::text || '@example.test';
  key text; actual text; attempt integer;
begin
  insert into public.companies(id,name,source,status) values(company,'Lead tag rule QA','qa','new');
  insert into public.contacts(id,company_id,name,email) values(contact,company,'QA buyer',email);
  update public.workspace_ai_settings set policy=jsonb_set(policy,'{enabled}','false') where singleton;
  insert into public.shopify_leads(webhook_id,shop_domain,customer_id,email,company_name,status,company_id,contact_id)
    values(shopify_id,'qa.example.test','form:'||shopify_id,email,'QA buyer','processing',company,contact);
  key := 'conversation:shopify:' || shopify_id;
  if exists(select 1 from public.crm_email_tags where message_key=key) then raise exception 'Unprocessed lead was tagged'; end if;
  update public.shopify_leads set status='processed' where webhook_id=shopify_id;
  select tag into actual from public.crm_email_tags where message_key=key;
  if actual is distinct from 'New Inquiries' then raise exception 'Shopify default must work with AI disabled'; end if;
  if not exists(select 1 from public.crm_email_tags where message_key=key and source='rule' and company_id=company) then raise exception 'Missing rule provenance'; end if;
  update public.crm_email_tags set tag=null,source='manual' where message_key=key;
  update public.shopify_leads set status='processed' where webhook_id=shopify_id;
  if exists(select 1 from public.crm_email_tags where message_key=key and tag is not null) then raise exception 'Shopify retry reset a manual removal'; end if;
  insert into public.meta_leads(leadgen_id,page_id,full_name,email,field_data,company_id,contact_id)
    values(meta_id,'qa','QA buyer',email,'[]',company,contact);
  select tag into actual from public.crm_email_tags where message_key='conversation:meta-lead:'||meta_id;
  if actual is distinct from 'New Inquiries' then raise exception 'Meta default must work with AI disabled'; end if;
  update public.crm_email_tags set tag='Active Negotiations',source='manual' where message_key='conversation:meta-lead:'||meta_id;
  update public.meta_leads set company_id=company where leadgen_id=meta_id;
  select tag into actual from public.crm_email_tags where message_key='conversation:meta-lead:'||meta_id;
  if actual is distinct from 'Active Negotiations' then raise exception 'Meta redelivery reset an advanced tag'; end if;

  insert into public.meta_leads(leadgen_id,page_id,field_data) values(delayed_meta_id,'qa','[]');
  if exists(select 1 from public.crm_email_tags where message_key='conversation:meta-lead:'||delayed_meta_id) then raise exception 'Incomplete Meta lead was tagged before company linking'; end if;
  -- company_id is filled by the BEFORE linking trigger, not explicitly in this UPDATE.
  update public.meta_leads set email=(select c.email::text from public.contacts c where c.id=contact),full_name='QA delayed buyer' where leadgen_id=delayed_meta_id;
  select tag into actual from public.crm_email_tags where message_key='conversation:meta-lead:'||delayed_meta_id;
  if actual is distinct from 'New Inquiries' then raise exception 'Delayed Meta form details missed the default inquiry rule'; end if;

  if has_function_privilege('authenticated','public.tag_imported_lead_inquiry()','EXECUTE')
    or has_function_privilege('anon','public.finish_conversation_tag_analysis_with_metrics(text,uuid,text[],text[],text,text,numeric,text,jsonb,boolean,jsonb)','EXECUTE') then
    raise exception 'Rule and metrics functions must be service-only';
  end if;
  update public.workspace_ai_settings set policy=jsonb_set(policy,'{enabled}','true') where singleton;
  -- Failed input backs off without needing another model request to decide when to retry.
  key := 'conversation:cost-qa:' || shopify_id;
  for attempt in 1..4 loop
    if attempt > 1 then update public.crm_conversation_tag_analysis set checked_at=now()-interval '2 days',retry_at=now()-interval '1 minute' where conversation_key=key; end if;
    if not public.claim_conversation_tag_analysis(key,'same-input',now(),1,token) then raise exception 'Retry claim failed'; end if;
    perform public.finish_conversation_tag_analysis_with_metrics(key,token,array[key],array[]::text[],email,null,0,'Provider failed','[]',true,
      '{"source":"ai","providerCalls":1,"promptCharacters":1000,"usage":{"inputTokens":200,"outputTokens":60,"cachedInputTokens":0}}');
    if not exists(select 1 from public.crm_conversation_tag_analysis where conversation_key=key and attempts=attempt and last_cost_metrics->>'providerCalls'='1'
      and retry_at >= now() + case attempt when 1 then interval '15 minutes' when 2 then interval '1 hour' when 3 then interval '6 hours' else interval '24 hours' end) then
      raise exception 'Retry backoff or cost metrics were not recorded';
    end if;
    if public.claim_conversation_tag_analysis(key,'same-input',now(),1,token) then raise exception 'Immediate retry bought another AI call'; end if;
  end loop;
end $$;
rollback;
