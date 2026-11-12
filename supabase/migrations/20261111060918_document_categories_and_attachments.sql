alter table public.library_documents
  add column category text not null default 'general' check (category in ('general','quotation','proforma','invoice','purchase_order','payment','catalog','datasheet','certificate','policy','promotion','everyday')),
  add column related_ids uuid[] not null default '{}' check (cardinality(related_ids) <= 10);
update public.library_documents set category='everyday' where kind='template';
create index library_documents_category on public.library_documents(workspace_id,category,updated_at desc);
notify pgrst,'reload schema';
