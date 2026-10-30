begin;

-- New action kinds use the existing JSON configuration and atomic save service.
-- No existing definitions or runs are rewritten.
alter table public.flow_steps drop constraint flow_steps_type_check;
alter table public.flow_steps add constraint flow_steps_type_check check (
  type in ('wait','split','if_condition','send_email','ai_auto_reply','create_task','change_category','update_company','internal_alert','stop')
);

notify pgrst, 'reload schema';
commit;
