-- Rollback-only integration fixtures. Nothing is sent or permanently saved.
begin;
set local statement_timeout='20s';
do $$
declare actor uuid; customer uuid:=gen_random_uuid(); contact uuid:=gen_random_uuid(); quote uuid; flow uuid; run uuid; last_at timestamptz; count_active integer;
begin
  select owner_id into actor from public.workspaces where is_legacy limit 1;
  insert into public.companies(id,name,status) values(customer,'Automation QA DO NOT CONTACT','qualified');
  insert into public.contacts(id,company_id,email,verification_status) values(contact,customer,'automation-qa-'||contact||'@example.invalid','valid');
  insert into public.pipeline(company_id,owner_id) values(customer,actor)
    on conflict(workspace_id,company_id) do update set owner_id=excluded.owner_id;
  insert into public.catalogs(user_id,company_id,product_skus,product_snapshot,currency,version,quote_status,quote_document)
    select actor,customer,product_skus,product_snapshot,currency,1,'shared',quote_document from public.catalogs where quote_document is not null limit 1 returning id into quote;
  assert quote is not null,'A saved quotation fixture is required';
  insert into public.emails(contact_id,direction,status,body,message_id,sent_at,created_at)
    values(contact,'sent','sent','Disposable old quotation','<qa-old-'||contact||'@example.invalid>',now()-interval '2 months',now()-interval '2 months');
  assert (select eligible from public.crm_dormant_customers(actor,1,customer)), 'Quoted customers become eligible after inactivity';
  update public.pipeline set next_followup_at=now()+interval '1 day' where company_id=customer;
  assert not (select eligible from public.crm_dormant_customers(actor,1,customer)), 'A scheduled manual follow-up excludes this customer';
  update public.pipeline set next_followup_at=null where company_id=customer;
  insert into public.flows(user_id,name,trigger_type,trigger_config,status,created_by)
    values(actor,'Disposable dormant verification','dormant_customer','{"inactivityMonths":1}','draft',actor) returning id into flow;
  insert into public.flow_runs(flow_id,conversation_id,company_id,contact_id,status,context)
    values(flow,'company:'||customer,customer,contact,'active','{"automationKind":"dormant_customer"}') returning id into run;
  begin
    insert into public.flow_runs(flow_id,conversation_id,company_id,contact_id,status,context)
      values(flow,'another-conversation:'||customer,customer,contact,'active','{"automationKind":"dormant_customer"}');
    raise exception 'Duplicate company nurture must be rejected';
  exception when unique_violation then null; end;
  insert into public.flow_run_logs(run_id,result) values(run,jsonb_build_object('action','email_sent','messageId','<qa-auto-'||contact||'@example.invalid>'));
  insert into public.emails(contact_id,direction,status,body,message_id,sent_at)
    values(contact,'sent','sent','Disposable automatic follow-up','<qa-auto-'||contact||'@example.invalid>',now());
  assert (select eligible from public.crm_dormant_customers(actor,1,customer)), 'Automated workflow sends do not reset human activity';
  insert into public.emails(contact_id,direction,status,body,message_id)
    values(contact,'received','received','Disposable reply','<qa-reply-'||contact||'@example.invalid>');
  assert not (select eligible from public.crm_dormant_customers(actor,1,customer)), 'A customer reply ends inactivity';
  assert not has_function_privilege('authenticated','public.crm_dormant_customers(uuid,integer,uuid,uuid)','EXECUTE'), 'Browser roles cannot inspect workspace-wide activity';
end;
$$;
select 'Inactive eligibility, manual takeover, automated-send exclusion, reply stop, company deduplication and browser isolation passed' as result;
rollback;
