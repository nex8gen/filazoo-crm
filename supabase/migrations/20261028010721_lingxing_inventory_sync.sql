-- ERP snapshots are separate from editable catalog/pricing data. Only the
-- authenticated application server can read or publish them.
create table public.inventory_sync_runs (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  rows_seen integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index inventory_one_running on public.inventory_sync_runs ((true)) where status = 'running';
create index inventory_sync_scope_started on public.inventory_sync_runs (scope, started_at desc);

create table public.erp_inventory (
  sku text primary key check (length(btrim(sku)) > 0),
  scope text not null,
  available bigint not null,
  on_hand bigint not null,
  locked bigint not null,
  warehouse_ids text[] not null,
  synced_at timestamptz not null,
  run_id uuid not null references public.inventory_sync_runs(id)
);
create index erp_inventory_scope_sku on public.erp_inventory(scope, sku);
alter table public.inventory_sync_runs enable row level security;
alter table public.erp_inventory enable row level security;
revoke all on public.inventory_sync_runs, public.erp_inventory from public, anon, authenticated;
grant select, insert, update, delete on public.inventory_sync_runs, public.erp_inventory to service_role;

create function public.claim_inventory_sync(p_scope text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if not pg_try_advisory_xact_lock(741850201) then return null; end if;
  update public.inventory_sync_runs
    set status = 'failed', finished_at = now(), error_message = 'Previous sync timed out. Previous stock was kept.'
    where status = 'running' and started_at <= now() - interval '5 minutes';
  if exists (select 1 from public.inventory_sync_runs where status = 'running') then return null; end if;
  if exists (select 1 from public.inventory_sync_runs where scope = p_scope and started_at > now() - interval '30 seconds') then return null; end if;
  insert into public.inventory_sync_runs(scope, status) values(p_scope, 'running') returning id into v_id;
  return v_id;
end;
$$;

create function public.finish_inventory_sync(p_run_id uuid, p_entries jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_scope text; v_started_at timestamptz;
begin
  -- Serializes publication with claim/expiry; expired workers cannot publish.
  perform pg_advisory_xact_lock(741850201);
  select scope, started_at into v_scope, v_started_at from public.inventory_sync_runs
    where id = p_run_id and status = 'running' for update;
  if v_scope is null or v_started_at <= now() - interval '5 minutes' then raise exception 'Inventory sync lease expired'; end if;
  if jsonb_typeof(p_entries) is distinct from 'array' then raise exception 'Invalid stock snapshot'; end if;
  -- Replacement and run completion commit together. Failed/incomplete pages
  -- never call this function, so the last complete snapshot stays intact.
  delete from public.erp_inventory;
  insert into public.erp_inventory(sku, scope, available, on_hand, locked, warehouse_ids, synced_at, run_id)
    select sku, v_scope, available, on_hand, locked, warehouse_ids, v_started_at, p_run_id
    from jsonb_to_recordset(p_entries) as x(sku text, available bigint, on_hand bigint, locked bigint, warehouse_ids text[]);
  update public.inventory_sync_runs set status = 'succeeded', rows_seen = jsonb_array_length(p_entries), finished_at = now()
    where id = p_run_id;
end;
$$;
revoke all on function public.claim_inventory_sync(text), public.finish_inventory_sync(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_inventory_sync(text), public.finish_inventory_sync(uuid, jsonb) to service_role;
