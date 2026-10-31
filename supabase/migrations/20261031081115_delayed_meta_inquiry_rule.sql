-- BEFORE linking can populate company_id while the UPDATE names only email/form
-- fields. UPDATE OF company_id would miss those delayed-detail deliveries.
drop trigger meta_lead_initial_inquiry on public.meta_leads;
create trigger meta_lead_initial_inquiry after insert or update on public.meta_leads
  for each row execute function public.tag_imported_lead_inquiry();
