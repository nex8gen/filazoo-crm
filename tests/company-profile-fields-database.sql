-- Real database regression. All synthetic profiles, events, tasks and updates roll back.
begin;
do $$
declare
  actor uuid;
  customer uuid := gen_random_uuid();
  primary_id uuid := gen_random_uuid();
  secondary_id uuid := gen_random_uuid();
  field text;
  value jsonb;
  profile jsonb;
  result jsonb;
  before_name text;
begin
  select user_id into actor from public.workspace_members where activated_at is not null and role = 'admin' limit 1;
  if actor is null then raise exception 'An active administrator is required for this rollback test.'; end if;
  insert into public.companies(id,name,source) values(customer,'Profile patch regression','manual');
  insert into public.contacts(id,company_id,name,email,created_at) values(primary_id,customer,'Primary buyer',customer::text || '@example.invalid',now()-interval '1 day');
  insert into public.contacts(id,company_id,name,email) values(secondary_id,customer,'Secondary buyer',secondary_id::text || '@example.invalid');
  insert into public.customer_billing_profiles(company_id,profile) values(customer,'{"taxId":"KEEP-TAX","email":"legacy-invalid","customLegacy":"preserve"}');

  -- The reported failure: no company country/segment and unrelated invalid legacy email.
  result := public.patch_company_profile_fields(customer,actor,'{"commerce":{"shippingRecipient":"Jimmy Przybylinski","shippingAddress":"1 Dixon Ln, Tarrytown, NY 10591, United States"}}');
  select p.profile into profile from public.customer_billing_profiles p where company_id=customer;
  if profile->>'shippingAddress' <> '1 Dixon Ln, Tarrytown, NY 10591, United States' or profile->>'taxId' <> 'KEEP-TAX' or profile->>'email' <> 'legacy-invalid' then raise exception 'Shipping patch lost supplied or unrelated billing data'; end if;
  if exists(select 1 from public.companies where id=customer and (country is not null or segment is not null or status <> 'new')) then raise exception 'Shipping patch changed unrelated company fields'; end if;
  if exists(select 1 from public.pipeline where company_id=customer) or exists(select 1 from public.company_profiles where company_id=customer) then raise exception 'Shipping patch manufactured unrelated records'; end if;
  if exists(select 1 from public.contacts where id=secondary_id and name <> 'Secondary buyer') then raise exception 'Secondary contact changed'; end if;

  -- Every flat editable field, independently; absent fields must never be required.
  for field,value in select * from jsonb_each(jsonb_build_object(
    'name','Updated regression profile','website','https://' || customer::text || '.example.invalid/path',
    'country','United States','city','Tarrytown','segment','Manufacturing',
    'contactName','Jimmy','contactRole','Buyer','contactEmail',primary_id::text || '@example.invalid',
    'stage','interested','estimatedOrderQuantity',200,'estimatedValue',1234.56,'currency','CAD',
    'nextFollowupAt','2026-10-29T09:00:00+08:00','summary','Saved account notes','fitScore',8,'tags','PLA, PETG'
  )) loop
    perform public.patch_company_profile_fields(customer,actor,jsonb_build_object(field,value));
  end loop;
  if not exists(select 1 from public.companies where id=customer and name='Updated regression profile' and country='United States' and city='Tarrytown' and segment='Manufacturing' and domain=customer::text || '.example.invalid') then raise exception 'Company fields did not save'; end if;
  if not exists(select 1 from public.contacts where id=primary_id and name='Jimmy' and role='Buyer' and email=primary_id::text || '@example.invalid') then raise exception 'Contact fields did not save'; end if;
  if not exists(select 1 from public.pipeline where company_id=customer and stage='interested' and currency='CAD' and estimated_order_quantity=200 and estimated_value=1234.56 and next_followup_at='2026-10-29T01:00:00Z') then raise exception 'Pipeline fields did not save'; end if;
  if not exists(select 1 from public.company_profiles where company_id=customer and summary='Saved account notes' and fit_score=8 and interest_tags=array['PLA','PETG']) then raise exception 'Profile fields did not save'; end if;

  -- Every billing/shipping field, independently; merge JSON without replacing defaults.
  for field,value in select * from jsonb_each('{
    "phone":"+1 555 0100","shippingRecipient":"Jimmy","shippingPhone":"+1 555 0101",
    "shippingAddress":"Updated warehouse, United States","shippingNotes":"Weekdays",
    "address":"Billing office","taxId":"VAT-42","email":"billing@example.invalid","currency":"USD","termsDays":30
  }'::jsonb) loop
    perform public.patch_company_profile_fields(customer,actor,jsonb_build_object('commerce',jsonb_build_object(field,value)));
    select p.profile into profile from public.customer_billing_profiles p where company_id=customer;
    if profile->field is distinct from value or profile->>'customLegacy' <> 'preserve' then raise exception 'Commerce patch failed for %',field; end if;
  end loop;

  -- Failure late in a multi-table patch must undo the earlier company write.
  select name into before_name from public.companies where id=customer;
  begin
    perform public.patch_company_profile_fields(customer,actor,'{"name":"Must roll back","fitScore":99}');
    raise exception 'Expected invalid fit score failure';
  exception when check_violation then null;
  end;
  if (select name from public.companies where id=customer) <> before_name then raise exception 'Partial writes survived a failed patch'; end if;
  begin
    perform public.patch_company_profile_fields(customer,gen_random_uuid(),'{"city":"Unauthorized"}');
    raise exception 'Expected authorization failure';
  exception when raise_exception then
    if sqlerrm <> 'Your workspace role cannot edit customer profiles.' then raise; end if;
  end;
  begin
    perform public.patch_company_profile_fields(customer,actor,'{"owner_id":"unsupported"}');
    raise exception 'Expected unsupported-field failure';
  exception when raise_exception then
    if sqlerrm <> 'Unsupported customer profile field.' then raise; end if;
  end;
  perform public.patch_company_profile_fields(customer,actor,'{"fitScore":"","estimatedOrderQuantity":"","estimatedValue":"","nextFollowupAt":""}');
  if exists(select 1 from public.pipeline where company_id=customer and (estimated_order_quantity is not null or estimated_value is not null or next_followup_at is not null)) then raise exception 'Explicit clears did not save'; end if;
  if has_function_privilege('anon','public.patch_company_profile_fields(uuid,uuid,jsonb)','execute') or has_function_privilege('authenticated','public.patch_company_profile_fields(uuid,uuid,jsonb)','execute') then raise exception 'Profile patch RPC is exposed to browser roles'; end if;
end;
$$;
select 'PASS: all profile fields, incomplete records, isolation, permissions and rollback' as result;
rollback;
