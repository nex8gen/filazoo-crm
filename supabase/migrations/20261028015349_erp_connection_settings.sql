create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table public.erp_connection_settings (
  singleton boolean primary key default true check (singleton),
  provider text not null default 'lingxing' check (provider = 'lingxing'),
  name text not null,
  app_id text not null,
  app_secret_id uuid not null,
  worker_secret_id uuid not null,
  warehouse_ids text[] not null default '{}',
  sku_map jsonb not null default '{}' check (jsonb_typeof(sku_map) = 'object'),
  enabled boolean not null default true,
  sync_interval integer not null default 0 check (sync_interval in (0,5,15,60,1440)),
  worker_url text,
  revision integer not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  last_dispatched_at timestamptz,
  last_dispatch_id bigint,
  last_dispatch_error text
);
alter table public.erp_connection_settings enable row level security;
revoke all on public.erp_connection_settings from public, anon, authenticated;
grant select, insert, update, delete on public.erp_connection_settings to service_role;

-- All functions use caller privileges. Secrets are encrypted by Supabase
-- Vault, and only server service-role RPCs may retrieve the decrypted value.
create function public.read_erp_connection() returns jsonb
language sql security invoker set search_path = '' as $$
  select to_jsonb(s) - 'app_secret_id' - 'worker_secret_id' || jsonb_build_object('app_secret', v.decrypted_secret)
  from public.erp_connection_settings s join vault.decrypted_secrets v on v.id = s.app_secret_id
  where s.singleton;
$$;

create function public.save_erp_connection(
  p_name text, p_app_id text, p_app_secret text, p_warehouse_ids text[],
  p_sku_map jsonb, p_enabled boolean, p_sync_interval integer,
  p_worker_url text, p_revision integer, p_updated_by uuid
) returns integer language plpgsql security invoker set search_path = '' as $$
declare v_current public.erp_connection_settings; v_secret_id uuid; v_worker_id uuid; v_revision integer;
begin
  perform pg_advisory_xact_lock(741850202);
  select * into v_current from public.erp_connection_settings where singleton for update;
  if coalesce(v_current.revision, 0) <> p_revision then raise exception using errcode = '40001', message = 'ERP settings changed. Refresh and try again.'; end if;
  if length(btrim(p_name)) not between 1 and 100 or octet_length(p_app_id) not in (16,24,32) then raise exception 'Invalid ERP connection details'; end if;
  if jsonb_typeof(p_sku_map) is distinct from 'object' then raise exception 'Invalid SKU mappings'; end if;
  if p_enabled and p_sync_interval > 0 and (p_worker_url is null or p_worker_url !~ '^https://([a-zA-Z0-9][a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}/api/cron/inventory$') then raise exception 'Automatic sync requires a public HTTPS CRM URL'; end if;
  v_secret_id := v_current.app_secret_id;
  if nullif(btrim(p_app_secret), '') is not null then
    if v_secret_id is null then v_secret_id := vault.create_secret(p_app_secret, null, 'Filazoo Lingxing API credential');
    else perform vault.update_secret(v_secret_id, p_app_secret); end if;
  elsif v_secret_id is null or v_current.app_id <> p_app_id then raise exception 'App Secret is required for a new App ID';
  end if;
  v_worker_id := v_current.worker_secret_id;
  if v_worker_id is null then v_worker_id := vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), null, 'Filazoo inventory scheduler credential'); end if;
  v_revision := coalesce(v_current.revision, 0) + 1;
  insert into public.erp_connection_settings(singleton,name,app_id,app_secret_id,worker_secret_id,warehouse_ids,sku_map,enabled,sync_interval,worker_url,revision,updated_by)
    values(true,p_name,p_app_id,v_secret_id,v_worker_id,p_warehouse_ids,p_sku_map,p_enabled,p_sync_interval,p_worker_url,v_revision,p_updated_by)
    on conflict(singleton) do update set name=excluded.name,app_id=excluded.app_id,app_secret_id=excluded.app_secret_id,
      warehouse_ids=excluded.warehouse_ids,sku_map=excluded.sku_map,enabled=excluded.enabled,sync_interval=excluded.sync_interval,
      worker_url=excluded.worker_url,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=now(),
      last_dispatched_at=null,last_dispatch_id=null,last_dispatch_error=null;
  return v_revision;
end;
$$;

create function public.erp_worker_authorized(p_secret text) returns boolean
language sql security invoker set search_path = '' as $$
  select exists(select 1 from public.erp_connection_settings s join vault.decrypted_secrets v on v.id=s.worker_secret_id
    where s.singleton and s.enabled and extensions.digest(p_secret,'sha256') = extensions.digest(v.decrypted_secret,'sha256'));
$$;

create function public.dispatch_erp_inventory_sync() returns bigint
language plpgsql security invoker set search_path = '' as $$
declare v_settings public.erp_connection_settings; v_secret text; v_id bigint;
begin
  if not pg_try_advisory_xact_lock(741850203) then return null; end if;
  select * into v_settings from public.erp_connection_settings where singleton and enabled and sync_interval > 0
    and (last_dispatched_at is null or last_dispatched_at <= now() - make_interval(mins => sync_interval)) for update;
  if not found then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where id=v_settings.worker_secret_id;
  if v_secret is null then raise exception 'Inventory worker credential unavailable'; end if;
  v_id := net.http_get(url := v_settings.worker_url, headers := jsonb_build_object('Authorization','Bearer '||v_secret), timeout_milliseconds := 290000);
  update public.erp_connection_settings set last_dispatched_at=now(),last_dispatch_id=v_id,last_dispatch_error=null where singleton;
  return v_id;
exception when others then
  update public.erp_connection_settings set last_dispatch_error='Automatic stock sync could not be requested. Check the deployed CRM address.' where singleton;
  return null;
end;
$$;

revoke all on function public.read_erp_connection(), public.save_erp_connection(text,text,text,text[],jsonb,boolean,integer,text,integer,uuid), public.erp_worker_authorized(text), public.dispatch_erp_inventory_sync() from public, anon, authenticated;
grant execute on function public.read_erp_connection(), public.save_erp_connection(text,text,text,text[],jsonb,boolean,integer,text,integer,uuid), public.erp_worker_authorized(text), public.dispatch_erp_inventory_sync() to service_role;

-- This tick is idle until an administrator saves an enabled automatic
-- connection. Cron runs as its migration owner; no service-role elevation.
select cron.schedule('filazoo-erp-inventory-tick','*/5 * * * *','select public.dispatch_erp_inventory_sync();');
