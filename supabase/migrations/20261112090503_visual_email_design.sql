alter table public.library_documents add column email_design jsonb;
alter table public.library_documents add constraint library_email_design_object
  check (email_design is null or (kind='template' and jsonb_typeof(email_design)='object'));
notify pgrst,'reload schema';
