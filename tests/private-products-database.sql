-- Read/write checks roll back all test rows and changes.
begin;
do $$
declare a uuid; b uuid; customer uuid; first_catalog uuid; next_version integer;
begin
  select user_id into a from public.workspace_members where activated_at is not null order by user_id limit 1;
  select user_id into b from public.workspace_members where activated_at is not null and user_id <> a order by user_id limit 1;
  if a is null or b is null then raise exception 'Two active workspace users are required for this verification.'; end if;
  if has_table_privilege('anon','public.user_product_overrides','select')
    or has_table_privilege('authenticated','public.user_product_overrides','select')
    or has_table_privilege('authenticated','public.user_product_overrides','insert') then
    raise exception 'TEST FAILED: private product storage is exposed to browser roles';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.user_product_overrides'::regclass) then
    raise exception 'TEST FAILED: RLS is disabled';
  end if;
  if (select public from storage.buckets where id='user-product-images') then raise exception 'TEST FAILED: product uploads are public'; end if;
  insert into public.companies(name) values('Product privacy rollback verification') returning id into customer;
  insert into public.catalogs(user_id,company_id,product_skus,product_snapshot,currency,version)
    values(a,customer,array['ABS'],'[{"sku":"ABS","price":"$8.00"}]','USD',99) returning id into first_catalog;
  if (select version from public.catalogs where id=first_catalog) <> 1 then raise exception 'TEST FAILED: owner version not allocated atomically'; end if;
  insert into public.catalogs(user_id,company_id,product_skus,product_snapshot,currency,version)
    values(b,customer,array['ABS'],'[{"sku":"ABS","price":"$9.00"}]','USD',99) returning version into next_version;
  if next_version <> 1 then raise exception 'TEST FAILED: versions shared between accounts'; end if;
  insert into public.catalogs(user_id,company_id,product_skus,product_snapshot,currency,version)
    values(a,customer,array['ABS'],'[{"sku":"ABS","price":"$10.00"}]','USD',99) returning version into next_version;
  if next_version <> 2 then raise exception 'TEST FAILED: owner version sequence incorrect'; end if;
  begin
    update public.catalogs set user_id=b where id=first_catalog;
    raise exception 'TEST FAILED: ownership transfer accepted';
  exception when raise_exception then if sqlerrm not like 'Saved catalog versions are immutable%' then raise; end if; end;
  begin
    update public.catalogs set product_snapshot='[]' where id=first_catalog;
    raise exception 'TEST FAILED: old prices overwritten';
  exception when raise_exception then if sqlerrm not like 'Saved catalog versions are immutable%' then raise; end if; end;
  update public.catalogs set pdf_url='/api/catalogs/test/pdf' where id=first_catalog;
  if has_function_privilege('authenticated','public.guard_private_catalog()','execute') then raise exception 'TEST FAILED: trigger exposed'; end if;
end;
$$;
rollback;
