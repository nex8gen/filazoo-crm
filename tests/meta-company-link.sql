-- Run against a migrated database. Every test change is rolled back.
begin;
set local role service_role;
do $$
declare first_company uuid; second_company uuid; first_contact uuid; first_owner uuid; event_count integer;
begin
  insert into public.meta_leads(leadgen_id,page_id,form_id,full_name,email,phone,created_at,field_data)
  values('crm-meta-test-1','000000','000001','Integration Test','meta-integration@example.invalid','+10000000000','2026-10-01T10:00:00Z',
    '[{"name":"company_name","values":["Meta Integration Test"]},{"name":"website","values":["https://meta-integration.example.invalid"]},{"name":"what_is_your_expected_initial_order_quantity?","values":["50-100 kg"]}]')
  returning company_id,contact_id,owner_id into first_company,first_contact,first_owner;
  if first_company is null or first_contact is null or first_owner is null then raise exception 'Company/contact/assignment missing'; end if;
  if not exists(select 1 from public.companies where id=first_company and name='Meta Integration Test' and source='meta_lead_ads') then raise exception 'Company mapping failed'; end if;
  if not exists(select 1 from public.pipeline where company_id=first_company and estimated_order_quantity=50 and stage='new') then raise exception 'Pipeline mapping failed'; end if;
  update public.pipeline set stage='interested' where company_id=first_company;
  insert into public.meta_leads(leadgen_id,page_id,full_name,email,field_data)
  values('crm-meta-test-2','000000','Integration Test','META-INTEGRATION@EXAMPLE.INVALID','[]') returning company_id into second_company;
  if first_company <> second_company then raise exception 'Case-insensitive contact deduplication failed'; end if;
  if not exists(select 1 from public.pipeline where company_id=first_company and stage='interested' and owner_id=first_owner) then raise exception 'Existing stage/owner changed'; end if;
  update public.meta_leads set field_data=field_data where leadgen_id='crm-meta-test-1';
  select count(*) into event_count from public.events where company_id=first_company and type='meta_lead_received';
  if event_count <> 2 then raise exception 'Retry duplicated activity'; end if;
  if not exists(select 1 from public.events where company_id=first_company and data->>'leadgen_id'='crm-meta-test-1' and created_at='2026-10-01T10:00:00Z') then raise exception 'Original timestamp lost'; end if;
end;
$$;
rollback;
