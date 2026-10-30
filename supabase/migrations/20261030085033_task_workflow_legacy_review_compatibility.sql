-- Keep the old deployed task UI usable during application rollout. A legacy
-- request without on_reply has no prepared action to execute. Only that untouched
-- plain review may complete through the existing generic task control.
create or replace function public.guard_task_workflow_completion()
returns trigger language plpgsql security invoker set search_path='' as $$
declare w public.crm_task_workflows;
begin
  if new.status is distinct from old.status then
    select * into w from public.crm_task_workflows where task_id=old.id for update;
    if new.status='done' and w.task_id is not null and w.status<>'done' then
      if w.kind='reply_review' and w.status='preparing' and w.lease_until is null
        and w.payload->>'preparedAt' is null and w.payload->>'deliveryId' is null
        and exists(select 1 from public.agent_reply_requests r where r.id=w.request_id and r.on_reply is null) then
        update public.crm_task_workflows set status='done',revision=revision+1,updated_at=now() where task_id=old.id;
      else
        raise exception 'Finish the task using its workflow actions.';
      end if;
    end if;
    if new.status='cancelled' and w.status in ('sending','uncertain') then
      raise exception 'Check the existing email delivery before closing this task.';
    end if;
  end if;
  return new;
end; $$;
