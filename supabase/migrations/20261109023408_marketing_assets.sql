create table public.marketing_assets (
  workspace_id uuid not null default crm_tenancy.workspace_id() references public.workspaces(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  category text not null check (category in ('month_end','holiday','factory_sale')),
  slot text not null check (length(slot) between 1 and 80),
  year integer not null check (year between 2020 and 2100),
  title text not null check (length(title) between 1 and 160),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  product_skus text[] not null default '{}',
  audience text not null default '' check (length(audience) <= 2000),
  offer text not null default '' check (length(offer) <= 8000),
  message text not null default '' check (length(message) <= 12000),
  status text not null default 'draft' check (status in ('draft','ready')),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id,id),
  unique (workspace_id,category,year,slot),
  check (extract(year from start_date) = year),
  check (cardinality(product_skus) <= 100),
  check (status <> 'ready' or (length(trim(offer)) > 0 and length(trim(message)) > 0))
);
create index marketing_assets_calendar on public.marketing_assets(workspace_id,year,start_date);
alter table public.marketing_assets enable row level security;
revoke all on public.marketing_assets from anon,authenticated;
grant select,insert,update,delete on public.marketing_assets to crm_workspace_server,service_role;
create policy crm_workspace_isolation on public.marketing_assets to crm_workspace_server
  using (workspace_id=(select crm_tenancy.workspace_id()))
  with check (workspace_id=(select crm_tenancy.workspace_id()));
notify pgrst,'reload schema';
