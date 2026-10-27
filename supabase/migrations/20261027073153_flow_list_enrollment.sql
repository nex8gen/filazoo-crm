begin;

-- Source lists share the same immutable contact event keys and activation
-- boundaries as new-lead enrollment. Resume never imports historical members.
create or replace function public.set_flow_lead_enrollment_start()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.trigger_type in ('new_lead', 'lead_added_to_list') and new.status = 'live' then
    if tg_op = 'INSERT' then
      new.lead_enrollment_started_at := now();
    elsif old.status <> 'live' or old.trigger_type <> new.trigger_type or old.lead_enrollment_started_at is null then
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
update public.flows set lead_enrollment_started_at = now()
where status = 'live' and trigger_type = 'lead_added_to_list';

notify pgrst, 'reload schema';
commit;
