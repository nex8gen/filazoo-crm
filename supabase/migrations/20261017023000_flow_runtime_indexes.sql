begin;
create index if not exists crm_tasks_contact_id_idx on public.crm_tasks(contact_id);
create index if not exists crm_tasks_flow_run_id_idx on public.crm_tasks(flow_run_id);
create index if not exists internal_notifications_flow_run_id_idx on public.internal_notifications(flow_run_id);
commit;
