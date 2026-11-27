-- Rollback-only regression checks; no fixtures survive this transaction.
begin;
do $test$
declare
  a jsonb; b jsonb; last_page jsonb; ids uuid[]; tenant uuid := crm_tenancy.workspace_id();
  stamp timestamptz := '2026-11-27 00:00:00+00';
begin
  insert into public.companies(id,name,country,segment,source,created_at,discovered_at,workspace_id)
  select gen_random_uuid(),'Pagination regression '||lpad(n::text,2,'0'),
    case when n<=35 then 'Brazil' else 'Canada' end,'Pagination fixtures','manual',stamp,stamp,tenant
  from generate_series(1,61) n;
  select array_agg(id order by name) into ids from public.companies where workspace_id=tenant and name like 'Pagination regression %';
  insert into public.contacts(company_id,name,email,workspace_id) values(ids[61],'Fixture','pagination@example.invalid',tenant);
  insert into public.crm_email_tags(message_key,company_id,contact_email,tag,source,workspace_id)
    values('pagination-fixture',ids[61],'pagination@example.invalid','Inactive Customers','manual',tenant);
  a := public.crm_company_list_page(p_query=>'Pagination regression',p_sort=>'name',p_desc=>false,p_as_of=>stamp);
  b := public.crm_company_list_page(p_query=>'Pagination regression',p_sort=>'name',p_desc=>false,p_page=>2,p_as_of=>stamp);
  last_page := public.crm_company_list_page(p_query=>'Pagination regression',p_sort=>'name',p_desc=>false,p_page=>999999,p_as_of=>stamp);
  if (a->>'total')::int<>61 or jsonb_array_length(a->'ids')<>25 or (a->'ids'->>0)::uuid<>ids[1] then raise exception 'First page or sorting failed'; end if;
  if jsonb_array_length(a->'rows')<>25 or a->'rows'->0->'row'->>'id'<>a->'ids'->>0 then raise exception 'Visible row payload differs from selected IDs'; end if;
  if jsonb_array_length(b->'ids')<>25 or (b->'ids'->>0)::uuid<>ids[26] then raise exception 'Next page failed'; end if;
  if exists(select 1 from jsonb_array_elements_text(a->'ids') x join jsonb_array_elements_text(b->'ids') y on x.value=y.value) then raise exception 'Overlapping pages'; end if;
  if (last_page->>'page')::int<>3 or jsonb_array_length(last_page->'ids')<>11 then raise exception 'Last page failed'; end if;
  if a->'buckets'<>b->'buckets' or (a->'buckets'->0->'counts'->>0)::int<>61 then raise exception 'Overview depends on page'; end if;
  a := public.crm_company_list_page(p_query=>'Pagination regression',p_country=>'Canada',p_page=>5);
  if (a->>'total')::int<>26 or (a->>'page')::int<>2 or jsonb_array_length(a->'ids')<>1 then raise exception 'Country filter or stale page failed'; end if;
  a := public.crm_company_list_page(p_query=>'Pagination regression',p_tag=>'Inactive Customers');
  if (a->>'total')::int<>1 or (a->'ids'->>0)::uuid<>ids[61] then raise exception 'Tag filter missed later page'; end if;
  a := public.crm_company_list_page(p_query=>'pagination@example.invalid');
  if (a->>'total')::int<>1 then raise exception 'Email search missed later page'; end if;
  a := public.crm_company_list_page(p_query=>'Pagination regression',p_rules=>'{"hasEmail":true}');
  if (a->>'total')::int<>1 then raise exception 'Saved email rule failed'; end if;
  a := public.crm_company_list_page(p_query=>'Pagination regression',p_rules=>jsonb_build_object('companyIds',jsonb_build_array(ids[61])));
  if (a->>'total')::int<>1 then raise exception 'Manual segment failed'; end if;
  a := public.crm_company_list_page(p_query=>'Pagination regression',p_rules=>'{"stage":"new"}');
  if (a->>'total')::int<>0 then raise exception 'Retired stage rule failed'; end if;
  a := public.crm_company_list_page(p_query=>'Pagination regression',p_size=>10,p_sort=>'name',p_desc=>true);
  if jsonb_array_length(a->'ids')<>10 or (a->'ids'->>0)::uuid<>ids[61] then raise exception 'Page size or descending sort failed'; end if;
  a := public.crm_company_list_page(p_query=>'Pagination regression',p_owner=>gen_random_uuid());
  if (a->>'total')::int<>0 then raise exception 'Owner restriction failed'; end if;
  a := public.crm_company_list_page(p_query=>'Pagination regression %');
  if (a->>'total')::int<>0 or (a->>'page')::int<>1 then raise exception 'Literal search or empty state failed'; end if;
end $test$;
rollback;
select 'Company pagination database checks passed; fixtures rolled back.' as result;
