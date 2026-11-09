-- Execute in ONE transaction and roll back. No real customer rows are changed.
begin;
do $$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();tenant_a uuid;tenant_b uuid;search_a uuid;result jsonb;again jsonb;n integer;
begin
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    (owner_a,owner_a||'@lead-test.invalid',now(),'{"display_name":"Lead Test A"}'),
    (owner_b,owner_b||'@lead-test.invalid',now(),'{"display_name":"Lead Test B"}');
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform set_config('role','service_role',true);
  tenant_a:=public.create_crm_workspace(owner_a,'Lead Test A','lead-test-a-'||owner_a);
  insert into public.products(sku,name) values('SAME-SKU','Dining chairs');
  insert into public.ai_lead_searches(request_id,created_by,criteria,products,context_key,status,results)
    values(gen_random_uuid(),owner_a,'{}','[]','chairs-test','complete',jsonb_build_array(jsonb_build_object(
      'id','same-domain.invalid','name','Disposable hotel','website','https://same-domain.invalid','domain','same-domain.invalid',
      'country','Germany','city','Berlin','segment','Hotel','summary','Disposable research','fitScore',90,
      'matchedProducts',jsonb_build_array('Dining chairs'),'confidence','supported',
      'qualification','qualified','researchVersion',2,
      'fitEvidence',jsonb_build_object('value','Seating'),
      'locationEvidence',jsonb_build_object('value','Berlin, Germany'),
      'buyerEvidence',jsonb_build_object('value','Hotel'),
      'identityEvidence',jsonb_build_object('value','Disposable hotel'),
      'checks',(select jsonb_agg(jsonb_build_object('key',key,'state','met')) from unnest(array['product','location','buyer','requirements','identity']) key),
      'phones',jsonb_build_array(jsonb_build_object('value','+49 30 1234567')),
      'address',jsonb_build_object('value','Berlin, Germany'),
      'emails',jsonb_build_array(jsonb_build_object('value','sales@same-domain.invalid'))
    ))) returning id into search_a;
  insert into public.ai_lead_company_history(domain,company_name,search_id) values('same-domain.invalid','Disposable hotel',search_a);
  insert into public.ai_lead_company_history(domain,company_name,search_id) values('same-domain.invalid','Duplicate candidate',search_a) on conflict(workspace_id,domain) do nothing;
  if (select count(*) from public.ai_lead_company_history where domain='same-domain.invalid')<>1 then raise exception 'Candidate memory did not deduplicate';end if;
  result:=public.save_ai_lead(search_a,'same-domain.invalid',owner_a);
  again:=public.save_ai_lead(search_a,'same-domain.invalid',owner_a);
  if result->>'companyId' is distinct from again->>'companyId' or again->>'existing'<>'true' then raise exception 'Duplicate save created another company';end if;
  update public.ai_lead_searches set results=jsonb_set(results,'{0,qualification}','"review"') where id=search_a;
  begin
    perform public.save_ai_lead(search_a,'same-domain.invalid',owner_a);
    raise check_violation using message='Unqualified company passed the database save gate';
  exception when raise_exception then null;end;
  update public.ai_lead_searches set results=jsonb_set(results,'{0,qualification}','"qualified"') where id=search_a;
  select count(*) into n from public.contacts where company_id=(result->>'companyId')::uuid and verification_status='unverified' and consent_source='public_website_research';
  if n<>1 then raise exception 'Public contact did not remain unverified';end if;
  if not exists(select 1 from public.customer_billing_profiles where company_id=(result->>'companyId')::uuid and profile->>'phone'='+49 30 1234567' and profile->>'address'='Berlin, Germany') then raise exception 'Public phone and address were not saved to the company profile';end if;
  insert into public.ai_lead_feedback(context_key,domain,reason,created_by) values('chairs-test','same-domain.invalid','good_match',owner_a);
  insert into public.ai_lead_buyer_profiles(context_key,created_by,status,profile) values('chairs-test-profile',owner_a,'complete','{"category":"Commercial furniture"}');
  perform set_config('role','service_role',true);
  tenant_b:=public.create_crm_workspace(owner_b,'Lead Test B','lead-test-b-'||owner_b);
  insert into public.products(sku,name) values('SAME-SKU','Packaging');
  if exists(select 1 from public.ai_lead_searches where id=search_a) or exists(select 1 from public.ai_lead_feedback) or exists(select 1 from public.companies where id=(result->>'companyId')::uuid) then raise exception 'Lead records leaked between workspaces';end if;
  if exists(select 1 from public.ai_lead_buyer_profiles where context_key='chairs-test-profile') then raise exception 'Buyer profiles leaked between workspaces';end if;
  if exists(select 1 from public.ai_lead_company_history where domain='same-domain.invalid') then raise exception 'Discovery memory leaked between workspaces';end if;
  if (select name from public.products where sku='SAME-SKU')<>'Packaging' then raise exception 'Product context leaked';end if;
  begin
    perform public.save_ai_lead(search_a,'same-domain.invalid',owner_b);
    raise exception 'Cross-workspace lead was saved' using errcode='42501';
  exception when raise_exception then null;end;
  perform set_config('role','postgres',true);
end $$;
rollback;
