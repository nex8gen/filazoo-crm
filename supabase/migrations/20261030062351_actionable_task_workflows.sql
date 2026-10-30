begin;

alter table public.agent_reply_requests add column on_reply jsonb check(on_reply is null or jsonb_typeof(on_reply)='object');
create table public.crm_task_workflows (
  task_id uuid primary key references public.crm_tasks(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  kind text not null check(kind in ('invoice_review','email_follow_up','customer_details','payment_follow_up','reply_review')),
  status text not null default 'preparing' check(status in ('preparing','ready','blocked','sending','uncertain','done')),
  revision integer not null default 1 check(revision>0),
  request_id uuid references public.agent_reply_requests(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  payload jsonb not null default '{}' check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=150000),
  blockers jsonb not null default '[]' check(jsonb_typeof(blockers)='array'),
  lease_until timestamptz,
  last_actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index crm_task_workflows_owner on public.crm_task_workflows(owner_id);
create index crm_task_workflows_invoice on public.crm_task_workflows(invoice_id) where invoice_id is not null;
create index crm_task_workflows_request on public.crm_task_workflows(request_id) where request_id is not null;
create index crm_task_workflows_actor on public.crm_task_workflows(last_actor_id) where last_actor_id is not null;
create index crm_task_workflows_queue on public.crm_task_workflows(updated_at,task_id) where status='preparing';
alter table public.crm_task_workflows enable row level security;
revoke all on public.crm_task_workflows from public,anon,authenticated;
grant select,insert,update,delete on public.crm_task_workflows to service_role;

create table public.crm_task_workflow_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.crm_tasks(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null, status text not null, revision integer not null,
  created_at timestamptz not null default now()
);
create index crm_task_workflow_events_task on public.crm_task_workflow_events(task_id,created_at);
create index crm_task_workflow_events_actor on public.crm_task_workflow_events(actor_id) where actor_id is not null;
alter table public.crm_task_workflow_events enable row level security;
revoke all on public.crm_task_workflow_events from public,anon,authenticated;
grant select,insert on public.crm_task_workflow_events to service_role;
grant usage,select on sequence public.crm_task_workflow_events_id_seq to service_role;

create function public.audit_task_workflow() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  insert into public.crm_task_workflow_events(task_id,actor_id,kind,status,revision)
    values(new.task_id,coalesce(new.last_actor_id,new.owner_id),new.kind,new.status,new.revision);
  if tg_op='UPDATE' and old.status<>new.status and new.status in ('ready','blocked') then
    update public.internal_notifications n set read_at=null,message=left(
      case when new.kind='invoice_review' and new.invoice_id is not null then 'Invoice draft ready to preview: '
           when new.status='blocked' then 'Task needs your input: ' else 'Task ready for review: ' end || t.title,500)
    from public.crm_tasks t where t.id=new.task_id and t.status='open' and n.task_id=t.id and n.user_id=t.assigned_to;
  end if;
  return new;
end; $$;
create trigger crm_task_workflow_audit after insert or update on public.crm_task_workflows for each row execute function public.audit_task_workflow();

create function public.seed_reply_task_workflow() returns trigger language plpgsql security invoker set search_path='' as $$
declare v_kind text;
begin
  if new.task_id is null or new.status not in ('received','expired','uncertain') then return new; end if;
  v_kind:=case when new.status<>'received' then 'email_follow_up'
    when new.on_reply->>'kind' in ('invoice_review','email_follow_up','customer_details','payment_follow_up','reply_review') then new.on_reply->>'kind'
    when new.invoice_id is not null or new.invoice_context is not null then 'invoice_review'
    when new.needed && array['shipping_address','billing_address','tax_id'] then 'customer_details' else 'reply_review' end;
  insert into public.crm_task_workflows(task_id,owner_id,request_id,kind,status,invoice_id,payload)
    values(new.task_id,new.user_id,new.id,v_kind,
      case when new.status='uncertain' then 'uncertain' else 'preparing' end,
      new.invoice_id,jsonb_build_object('input',coalesce(new.on_reply,jsonb_build_object('kind',v_kind))))
    on conflict(task_id) do nothing;
  return new;
end; $$;
create trigger agent_reply_task_workflow after update of task_id,status on public.agent_reply_requests for each row execute function public.seed_reply_task_workflow();

-- Only open existing handoffs are upgraded; completed work stays in its historical state.
insert into public.crm_task_workflows(task_id,owner_id,request_id,kind,status,invoice_id,payload)
  select r.task_id,r.user_id,r.id,
    case when r.status<>'received' then 'email_follow_up' when r.invoice_id is not null or r.invoice_context is not null then 'invoice_review'
      when r.needed && array['shipping_address','billing_address','tax_id'] then 'customer_details' else 'reply_review' end,
    case when r.status='uncertain' then 'uncertain' else 'preparing' end,r.invoice_id,'{}'::jsonb
  from public.agent_reply_requests r join public.crm_tasks t on t.id=r.task_id
  where t.status='open' and r.status in ('received','expired','uncertain') on conflict(task_id) do nothing;

create function public.claim_task_workflow(p_task uuid default null) returns setof public.crm_task_workflows
language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  select w.task_id into v_id from public.crm_task_workflows w join public.crm_tasks t on t.id=w.task_id
  where w.status='preparing' and t.status='open' and (p_task is null or w.task_id=p_task)
    and (w.lease_until is null or w.lease_until<now()) order by w.updated_at,w.task_id for update of w skip locked limit 1;
  if v_id is null then return; end if;
  return query update public.crm_task_workflows set lease_until=now()+interval '3 minutes',revision=revision+1,updated_at=now()
    where task_id=v_id returning *;
end; $$;

create function public.finish_task_workflow(p_task uuid,p_actor uuid,p_revision integer,p_payload jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare w public.crm_task_workflows; t public.crm_tasks; v_role text;
begin
  select * into t from public.crm_tasks where id=p_task for update;
  select * into w from public.crm_task_workflows where task_id=p_task for update;
  select role into v_role from public.workspace_members where user_id=p_actor and activated_at is not null;
  if w.task_id is null or w.revision<>p_revision or t.status<>'open' or v_role is null or v_role='viewer'
    or (t.assigned_to is distinct from p_actor and v_role not in ('admin','operator')) then return false; end if;
  if w.status in ('sending','uncertain') then
    if not exists(select 1 from public.email_send_operations e where e.id=(p_payload->>'deliveryId')::uuid and e.user_id=p_actor and e.status='sent') then return false; end if;
  elsif w.kind in ('invoice_review','email_follow_up','payment_follow_up') then
    return false;
  end if;
  update public.crm_task_workflows set status='done',revision=revision+1,payload=p_payload,last_actor_id=p_actor,lease_until=null,updated_at=now() where task_id=p_task;
  update public.crm_tasks set status='done',completed_at=now(),updated_at=now() where id=p_task;
  return true;
end; $$;

create function public.guard_task_workflow_completion() returns trigger language plpgsql security invoker set search_path='' as $$
declare v_status text;
begin
  if new.status is distinct from old.status then
    select status into v_status from public.crm_task_workflows where task_id=old.id;
    if new.status='done' and v_status is not null and v_status<>'done' then raise exception 'Finish the task using its workflow actions.'; end if;
    if new.status='cancelled' and v_status in ('sending','uncertain') then raise exception 'Check the existing email delivery before closing this task.'; end if;
  end if;
  return new;
end; $$;
create trigger crm_task_workflow_completion before update of status on public.crm_tasks for each row execute function public.guard_task_workflow_completion();

create function public.apply_task_workflow_details(p_task uuid,p_actor uuid,p_revision integer,p_changes jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare w public.crm_task_workflows; t public.crm_tasks; v_role text; v_profile jsonb; v_key text; v_value jsonb;
begin
  select * into t from public.crm_tasks where id=p_task for update;
  select * into w from public.crm_task_workflows where task_id=p_task for update;
  select role into v_role from public.workspace_members where user_id=p_actor and activated_at is not null;
  if w.task_id is null or w.revision<>p_revision or t.status<>'open' or w.status not in ('ready','blocked') or t.company_id is null
    or v_role is null or v_role='viewer' or (t.assigned_to is distinct from p_actor and v_role not in ('admin','operator')) then return false; end if;
  perform 1 from public.companies where id=t.company_id for update;
  select profile into v_profile from public.customer_billing_profiles where company_id=t.company_id for update;
  for v_key,v_value in select * from jsonb_each(p_changes) loop
    if v_key not in ('shippingAddress','shippingRecipient','shippingPhone','address','taxId') or jsonb_typeof(v_value)<>'string' then raise exception 'Unsupported customer detail'; end if;
    if coalesce(v_profile->v_key,'""'::jsonb)<>coalesce(w.payload->'profileBaseline'->v_key,'""'::jsonb) and v_profile->v_key<>v_value then raise exception 'Customer details changed. Prepare this task again before saving.'; end if;
  end loop;
  perform public.patch_company_profile_fields(t.company_id,p_actor,jsonb_build_object('commerce',p_changes));
  update public.crm_task_workflows set payload=payload||jsonb_build_object('changes','{}'::jsonb,'detailsApplied',true),revision=revision+1,last_actor_id=p_actor,updated_at=now() where task_id=p_task;
  return true;
end; $$;
revoke all on function public.audit_task_workflow(),public.seed_reply_task_workflow(),public.claim_task_workflow(uuid),public.finish_task_workflow(uuid,uuid,integer,jsonb),public.apply_task_workflow_details(uuid,uuid,integer,jsonb),public.guard_task_workflow_completion() from public,anon,authenticated;
grant execute on function public.audit_task_workflow(),public.seed_reply_task_workflow(),public.claim_task_workflow(uuid),public.finish_task_workflow(uuid,uuid,integer,jsonb),public.apply_task_workflow_details(uuid,uuid,integer,jsonb),public.guard_task_workflow_completion() to service_role;
notify pgrst,'reload schema';
commit;
