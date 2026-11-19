-- Manual stock belongs to the workspace; product pricing and media remain personal.
create table public.product_manual_stock (
  workspace_id uuid not null default crm_tenancy.workspace_id() references public.workspaces(id),
  sku text not null check (length(sku) between 1 and 120 and sku = btrim(sku)),
  location text not null check (length(location) between 1 and 100 and location = btrim(location)),
  quantity bigint check (quantity between 0 and 9007199254740991),
  revision uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null,
  primary key (workspace_id, sku, location)
);
create table public.product_stock_adjustments (
  workspace_id uuid not null default crm_tenancy.workspace_id() references public.workspaces(id),
  id uuid not null default gen_random_uuid(),
  sku text not null,
  location text not null,
  previous_quantity bigint,
  quantity bigint,
  reason text not null check (length(reason) between 1 and 300),
  actor_id uuid not null,
  actor_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, id)
);
create index product_stock_adjustments_lookup on public.product_stock_adjustments(workspace_id, sku, created_at desc);
alter table public.product_manual_stock enable row level security;
alter table public.product_stock_adjustments enable row level security;
create policy crm_workspace_isolation on public.product_manual_stock to crm_workspace_server
  using (workspace_id = (select crm_tenancy.workspace_id())) with check (workspace_id = (select crm_tenancy.workspace_id()));
create policy crm_workspace_isolation on public.product_stock_adjustments to crm_workspace_server
  using (workspace_id = (select crm_tenancy.workspace_id())) with check (workspace_id = (select crm_tenancy.workspace_id()));
revoke all on public.product_manual_stock, public.product_stock_adjustments from public, anon, authenticated, service_role;
grant select, insert, update on public.product_manual_stock to crm_workspace_server, service_role;
grant select, insert on public.product_stock_adjustments to crm_workspace_server, service_role;

create function public.adjust_product_manual_stock(p_sku text, p_location text, p_quantity bigint, p_expected_revision uuid, p_reason text, p_actor_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  tenant uuid := crm_tenancy.workspace_id();
  before public.product_manual_stock%rowtype;
  actor_name text;
  next_revision uuid := gen_random_uuid();
begin
  select coalesce(nullif(display_name,''),'Team member') into actor_name from public.workspace_members
    where workspace_id = tenant and user_id = p_actor_id and activated_at is not null and role in ('admin','operator','bd_manager');
  if actor_name is null then raise insufficient_privilege using message = 'A stock editor role is required'; end if;
  if p_sku is null or length(btrim(p_sku)) not between 1 and 120 or p_location is null or length(btrim(p_location)) not between 1 and 100
     or p_reason is null or length(btrim(p_reason)) not between 1 and 300 or (p_quantity is not null and p_quantity not between 0 and 9007199254740991) then
    raise exception 'Invalid inventory adjustment' using errcode = '22023';
  end if;
  p_sku := btrim(p_sku); p_location := btrim(p_location);
  -- Serialize even the first insert. The revision guards stale forms after the lock.
  perform pg_advisory_xact_lock(hashtextextended(tenant::text || ':' || p_sku || ':' || p_location,0));
  select * into before from public.product_manual_stock where workspace_id=tenant and sku=p_sku and location=p_location for update;
  if before.revision is distinct from p_expected_revision then
    raise exception 'Inventory changed. Reload stock before adjusting it.' using errcode='40001';
  end if;
  insert into public.product_manual_stock(workspace_id,sku,location,quantity,revision,updated_by)
    values(tenant,p_sku,p_location,p_quantity,next_revision,p_actor_id)
    on conflict(workspace_id,sku,location) do update set quantity=excluded.quantity, revision=excluded.revision, updated_by=excluded.updated_by, updated_at=clock_timestamp();
  insert into public.product_stock_adjustments(workspace_id,sku,location,previous_quantity,quantity,reason,actor_id,actor_name)
    values(tenant,p_sku,p_location,before.quantity,p_quantity,btrim(p_reason),p_actor_id,actor_name);
  return next_revision;
end;
$$;
revoke all on function public.adjust_product_manual_stock(text,text,bigint,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.adjust_product_manual_stock(text,text,bigint,uuid,text,uuid) to crm_workspace_server, service_role;
