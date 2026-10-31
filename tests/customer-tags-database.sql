begin;
do $$
declare
  company_a uuid;
  company_b uuid;
  tag_count integer;
begin
  insert into public.companies(name, source) values ('Customer tag transaction test A', 'sample_seed') returning id into company_a;
  insert into public.companies(name, source) values ('Customer tag transaction test B', 'sample_seed') returning id into company_b;
  insert into public.crm_email_tags(message_key, contact_email, tag) values
    ('customer-tag-test-inquiry', 'customer-tag-test@example.invalid', 'New Inquiries');
  insert into public.contacts(company_id, email) values (company_a, 'customer-tag-test@example.invalid');
  if not exists(select 1 from public.crm_email_tags where message_key='customer-tag-test-inquiry' and company_id=company_a) then
    raise exception 'Tag applied before contact creation was not linked';
  end if;
  insert into public.crm_email_tags(message_key, company_id, tag) values
    ('customer-tag-test-order', company_a, 'Orders in Fulfillment'),
    ('customer-tag-test-inquiry-2', company_a, 'New Inquiries'),
    ('customer-tag-test-other-company', company_b, 'Payment Follow-up');
  select count(distinct tag) into tag_count from public.crm_email_tags where company_id=company_a;
  if tag_count <> 2 then raise exception 'Company tags lost, duplicated or mixed with another company'; end if;
  update public.crm_email_tags set tag=null where message_key='customer-tag-test-order';
  select count(distinct tag) into tag_count from public.crm_email_tags where company_id=company_a;
  if tag_count <> 1 then raise exception 'Clearing a tag left a stale company badge'; end if;
  begin
    insert into public.crm_email_tags(message_key, tag) values ('customer-tag-test-invalid', 'Big order');
    raise exception 'Legacy tag unexpectedly accepted';
  exception when check_violation then null;
  end;
  if has_table_privilege('authenticated','public.crm_email_tags','INSERT') or
     has_table_privilege('anon','public.crm_email_tags','SELECT') then
    raise exception 'Shared tags bypass the authenticated server';
  end if;
end $$;
rollback;
