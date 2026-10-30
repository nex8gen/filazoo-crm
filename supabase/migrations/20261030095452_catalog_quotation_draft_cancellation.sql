-- Filename matches the version recorded by the connected Supabase migration service.
begin;
-- Cancelling an unsaved selection must not fabricate commercial details.
alter table public.catalogs drop constraint catalogs_quote_status_document;
alter table public.catalogs add constraint catalogs_quote_status_document
  check (quote_status in ('draft','cancelled') or quote_document is not null);
commit;
