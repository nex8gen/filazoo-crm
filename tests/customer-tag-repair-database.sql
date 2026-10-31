begin;
do $$
declare
  untouched uuid := gen_random_uuid(); progressed uuid := gen_random_uuid(); removed uuid := gen_random_uuid();
  first_contact uuid := gen_random_uuid(); later_contact uuid := gen_random_uuid();
  prefix text := 'qa-repair-' || gen_random_uuid()::text;
  first_email text; later_email text;
begin
  first_email := prefix || '@example.test'; later_email := prefix || '-later@example.test';
  insert into public.companies(id,name,source,status) values
    (untouched,'Untouched tag repair QA','qa','new'),(progressed,'Progressed tag repair QA','qa','new'),(removed,'Removed tag repair QA','qa','new');
  insert into public.contacts(id,company_id,name,email) values(first_contact,untouched,'QA buyer',first_email),(later_contact,progressed,'QA later buyer',later_email);
  insert into public.shopify_leads(webhook_id,shop_domain,customer_id,email,company_name,status,company_id,contact_id,created_at) values
    (prefix||'-first','qa.example.test','form:first',first_email,'QA first','processed',untouched,first_contact,now()-interval '2 days'),
    (prefix||'-later','qa.example.test','form:later',later_email,'QA later','processed',progressed,later_contact,now()-interval '2 days'),
    (prefix||'-removed','qa.example.test','form:removed',prefix||'-removed@example.test','QA removed','processed',removed,null,now()-interval '2 days');
  -- Simulate leads imported before the initial-inquiry triggers existed.
  delete from public.crm_email_tags where message_key in ('conversation:shopify:'||prefix||'-first','conversation:shopify:'||prefix||'-later');
  update public.crm_email_tags set tag=null,source='manual' where message_key='conversation:shopify:'||prefix||'-removed';
  insert into public.emails(contact_id,direction,status,subject,body,created_at)
    values(later_contact,'received','received','Purchase postponed','We postponed purchasing until January.',now());
  perform public.backfill_untouched_lead_inquiry_tags();
  if not exists(select 1 from public.crm_email_tags where company_id=untouched and tag='New Inquiries' and source='rule') then raise exception 'Untouched legacy inquiry was not repaired'; end if;
  if exists(select 1 from public.crm_email_tags where company_id=progressed and tag is not null) then raise exception 'Later customer activity was incorrectly reset to an inquiry'; end if;
  if exists(select 1 from public.crm_email_tags where company_id=removed and tag is not null) then raise exception 'Manual removal was overwritten'; end if;
  if public.backfill_untouched_lead_inquiry_tags() <> 0 then raise exception 'Repeated catch-up was not idempotent'; end if;

  insert into public.crm_email_tags(message_key,contact_email,tag,source)
    values('conversation:'||prefix||'-system','system@unmatched.example.test','Payment Follow-up','ai');
  if exists(select 1 from public.crm_email_tags where message_key='conversation:'||prefix||'-system' and tag is not null) then raise exception 'Unmatched sender created a purchasing tag'; end if;
  insert into public.crm_email_tags(message_key,contact_email,tag,source)
    values('conversation:'||prefix||'-matched',first_email,'New Inquiries','ai');
  if not exists(select 1 from public.crm_email_tags where message_key='conversation:'||prefix||'-matched' and company_id=untouched and tag='New Inquiries') then raise exception 'Known customer tag was not linked to its company'; end if;
  insert into public.crm_email_tags(message_key,company_id,contact_email,tag,source)
    values('conversation:'||prefix||'-wrong',progressed,first_email,'Payment Follow-up','ai');
  if exists(select 1 from public.crm_email_tags where message_key='conversation:'||prefix||'-wrong' and tag is not null) then raise exception 'AI tag was attached to a different company'; end if;
  if has_function_privilege('anon','public.backfill_untouched_lead_inquiry_tags()','EXECUTE') then raise exception 'Catch-up function is browser-accessible'; end if;
end $$;
rollback;
