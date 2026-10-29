-- Private customizations never rewrite the synchronized product baseline.
create table public.user_product_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_sku text not null references public.products(sku) on update cascade on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, product_sku)
);
alter table public.user_product_overrides enable row level security;
revoke all on public.user_product_overrides from public, anon, authenticated;
grant select, insert, update, delete on public.user_product_overrides to service_role;

alter table public.catalogs add column user_id uuid references auth.users(id) on delete cascade;
alter table public.catalogs add column product_snapshot jsonb check (jsonb_typeof(product_snapshot) = 'array');
create index catalogs_user_company_idx on public.catalogs(user_id, company_id, version desc);

-- Recover ownership only where historical audit evidence identifies its creator.
update public.catalogs c set user_id = evidence.actor_id
from (select distinct on (data->>'catalogId') data->>'catalogId' as catalog_id, actor_id
      from public.events where type = 'catalog_created' and actor_id is not null order by data->>'catalogId', created_at) evidence
where c.id::text = evidence.catalog_id;

create function public.guard_private_catalog() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.user_id is null or not exists (select 1 from public.workspace_members where user_id = new.user_id and activated_at is not null) then
      raise exception 'An active catalog owner is required.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':' || new.company_id::text, 0));
    select coalesce(max(version), 0) + 1 into new.version from public.catalogs where user_id = new.user_id and company_id = new.company_id;
  elsif new.user_id is distinct from old.user_id or new.product_snapshot is distinct from old.product_snapshot
    or new.product_skus is distinct from old.product_skus or new.company_id is distinct from old.company_id
    or new.version is distinct from old.version or new.currency is distinct from old.currency or new.price_date is distinct from old.price_date then
    raise exception 'Saved catalog versions are immutable. Create a new version.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_private_catalog() from public, anon, authenticated;
grant execute on function public.guard_private_catalog() to service_role;
create trigger guard_private_catalog before insert or update on public.catalogs for each row execute function public.guard_private_catalog();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('user-product-images', 'user-product-images', false, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;
