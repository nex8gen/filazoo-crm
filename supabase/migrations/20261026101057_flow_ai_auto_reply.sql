begin;

alter table public.flows drop constraint flows_trigger_type_check;
alter table public.flows add constraint flows_trigger_type_check check (
  trigger_type in ('new_lead','email_received','category_changed','no_reply','lead_added_to_list','company_segment_changed','pipeline_stage_changed')
);
alter table public.flow_steps drop constraint flow_steps_type_check;
alter table public.flow_steps add constraint flow_steps_type_check check (
  type in ('wait','if_condition','send_email','ai_auto_reply','create_task','change_category','internal_alert','stop')
);

alter table public.flows add column lead_enrollment_started_at timestamptz;

-- Keep the enrollment boundary on the server; never enroll a backlog when
-- a new-lead flow is enabled or resumed. Editing a live flow preserves it.
create function public.set_flow_lead_enrollment_start()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.trigger_type = 'new_lead' and new.status = 'live' then
    if tg_op = 'INSERT' then
      new.lead_enrollment_started_at := now();
    elsif old.status <> 'live' or old.trigger_type <> 'new_lead' then
      new.lead_enrollment_started_at := now();
    else
      new.lead_enrollment_started_at := old.lead_enrollment_started_at;
    end if;
  else
    new.lead_enrollment_started_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.set_flow_lead_enrollment_start() from public, anon, authenticated;
create trigger flows_lead_enrollment_start before insert or update on public.flows
for each row execute function public.set_flow_lead_enrollment_start();

notify pgrst, 'reload schema';
commit;
