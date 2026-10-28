begin;
set local role service_role;
do $$
declare v_revision integer; v_secret_id uuid; v_worker_id uuid; v_result jsonb; v_dispatch bigint;
begin
  if exists(select 1 from public.erp_connection_settings) then raise exception 'Run this isolated fixture before a real connection is configured'; end if;
  if has_table_privilege('authenticated','public.erp_connection_settings','select')
    or has_function_privilege('anon','public.read_erp_connection()','execute')
    or has_function_privilege('authenticated','public.save_erp_connection(text,text,text,text[],jsonb,boolean,integer,text,integer,uuid)','execute') then raise exception 'ERP credentials are publicly accessible'; end if;
  v_revision := public.save_erp_connection('Test ERP','1234567890123456','fixture-secret',array['1'],'{"CRM":"ERP"}',true,15,'https://crm.example.com/api/cron/inventory',0,null);
  if v_revision <> 1 then raise exception 'Wrong initial revision'; end if;
  select app_secret_id,worker_secret_id into v_secret_id,v_worker_id from public.erp_connection_settings;
  if not exists(select 1 from vault.secrets where id=v_secret_id and secret <> 'fixture-secret') then raise exception 'Credential was not encrypted'; end if;
  v_result := public.read_erp_connection();
  if v_result->>'app_secret' <> 'fixture-secret' or v_result ? 'worker_secret_id' then raise exception 'Invalid server credential projection'; end if;
  if not public.erp_worker_authorized((select decrypted_secret from vault.decrypted_secrets where id=v_worker_id)) then raise exception 'Scheduled worker authentication failed'; end if;
  if public.erp_worker_authorized('wrong') then raise exception 'Invalid worker credential was accepted'; end if;
  v_dispatch := public.dispatch_erp_inventory_sync();
  if v_dispatch is null then raise exception 'Automatic dispatcher did not queue the request'; end if;
  if public.dispatch_erp_inventory_sync() is not null then raise exception 'Dispatcher ignored the configured interval'; end if;
  begin
    perform public.save_erp_connection('Stale','1234567890123456','changed',array['1'],'{}',true,0,null,0,null);
    raise exception 'Stale settings were accepted';
  exception when serialization_failure then null;
  end;
  v_revision := public.save_erp_connection('Paused','1234567890123456',null,array['2'],'{}',false,15,null,1,null);
  if v_revision <> 2 or public.dispatch_erp_inventory_sync() is not null then raise exception 'Paused connection was scheduled'; end if;
  if public.erp_worker_authorized((select decrypted_secret from vault.decrypted_secrets where id=v_worker_id)) then raise exception 'Paused connection authorized a worker'; end if;
  if public.read_erp_connection()->>'app_secret' <> 'fixture-secret' then raise exception 'Blank field erased the saved credential'; end if;
  begin
    perform public.save_erp_connection('Wrong account','6543210987654321',null,array['1'],'{}',false,0,null,2,null);
    raise exception 'New App ID reused old secret';
  exception when raise_exception then
    if sqlerrm <> 'App Secret is required for a new App ID' then raise; end if;
  end;
end;
$$;
-- pg_net sends only after commit. Rollback cancels the fixture request and
-- removes all fixture connection data and Vault secrets.
rollback;
