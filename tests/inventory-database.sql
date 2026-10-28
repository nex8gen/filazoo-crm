-- Run against a database with the inventory migration; all test data rolls back.
begin;
set local role service_role;
do $$
declare v_run uuid; v_other uuid;
begin
  if has_table_privilege('anon', 'public.erp_inventory', 'select')
     or has_table_privilege('authenticated', 'public.erp_inventory', 'select')
     or has_function_privilege('anon', 'public.claim_inventory_sync(text)', 'execute')
     or has_function_privilege('authenticated', 'public.finish_inventory_sync(uuid,jsonb)', 'execute') then
    raise exception 'Stock is publicly accessible';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.erp_inventory'::regclass) then raise exception 'Missing stock RLS'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.inventory_sync_runs'::regclass) then raise exception 'Missing sync RLS'; end if;
  v_run := public.claim_inventory_sync('inventory-transaction-test');
  if v_run is null then raise exception 'Could not claim test run'; end if;
  v_other := public.claim_inventory_sync('other-test-scope');
  if v_other is not null then raise exception 'Concurrent sync was allowed'; end if;
  perform public.finish_inventory_sync(v_run, '[{"sku":"TEST-STOCK","available":0,"on_hand":2,"locked":2,"warehouse_ids":["1"]}]');
  if not exists(select 1 from public.erp_inventory where sku = 'TEST-STOCK' and available = 0 and locked = 2) then raise exception 'Zero stock was lost'; end if;
  if not exists(select 1 from public.inventory_sync_runs where id = v_run and status = 'succeeded' and rows_seen = 1) then raise exception 'Run did not complete'; end if;
  v_run := public.claim_inventory_sync('other-test-scope');
  if v_run is null then raise exception 'Could not claim second scope'; end if;
  begin
    perform public.finish_inventory_sync(v_run, '[{"sku":"INVALID","available":null,"on_hand":1,"locked":0,"warehouse_ids":["1"]}]');
    raise exception 'Invalid snapshot was accepted';
  exception when not_null_violation then null;
  end;
  if not exists(select 1 from public.erp_inventory where sku = 'TEST-STOCK') then raise exception 'Failed snapshot erased previous stock'; end if;
  update public.inventory_sync_runs set started_at = now() - interval '6 minutes' where id = v_run;
  begin
    perform public.finish_inventory_sync(v_run, '[]');
    raise exception 'Expired worker published';
  exception when raise_exception then
    if sqlerrm <> 'Inventory sync lease expired' then raise; end if;
  end;
  v_other := public.claim_inventory_sync('recovery-test-scope');
  if v_other is null then raise exception 'Expired lease was not recovered'; end if;
  perform public.finish_inventory_sync(v_other, '[]');
  if exists(select 1 from public.erp_inventory) then raise exception 'Empty complete snapshot retained obsolete stock'; end if;
end;
$$;
rollback;
