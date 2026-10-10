begin;

create schema if not exists extensions;
alter extension citext set schema extensions;

create index if not exists catalogs_company_id_idx
  on public.catalogs(company_id);
create index if not exists emails_approved_by_idx
  on public.emails(approved_by);
create index if not exists emails_catalog_id_idx
  on public.emails(catalog_id);
create index if not exists events_actor_id_idx
  on public.events(actor_id);
create index if not exists pipeline_owner_id_idx
  on public.pipeline(owner_id);

commit;
