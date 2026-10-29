begin;

create table public.agent_reply_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_role text not null check (owner_role in ('admin','operator','bd_manager')),
  company_id uuid not null references public.companies(id) on delete cascade,
  company_name text not null,
  mailbox_id uuid references public.workspace_mailboxes(id) on delete set null,
  recipient text not null check (char_length(recipient) between 3 and 320),
  subject text not null check (char_length(subject) between 1 and 300),
  body text not null check (char_length(body) <= 10000),
  needed text[] not null check (cardinality(needed) between 1 and 8),
  task_title text not null check (char_length(task_title) between 1 and 200),
  task_notes text not null check (char_length(task_notes) between 1 and 3000),
  task_priority text not null default 'normal' check (task_priority in ('low','normal','high')),
  invoice_id uuid references public.invoices(id) on delete set null,
  invoice_context jsonb,
  scope_key text not null,
  status text not null check (status in ('preparing','sending','waiting','received','cancelled','expired','uncertain','blocked')),
  revision integer not null default 1,
  message_id text, thread_key text, sent_record_id uuid,
  waiting_since timestamptz, send_started_at timestamptz,
  expires_at timestamptz not null,
  last_checked_at timestamptz, last_error text,
  reply_evidence jsonb,
  task_id uuid references public.crm_tasks(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.agent_reply_requests enable row level security;
revoke all on public.agent_reply_requests from public, anon, authenticated;
grant select,insert,update,delete on public.agent_reply_requests to service_role;
create index agent_reply_requests_owner on public.agent_reply_requests(user_id,created_at desc);
create index agent_reply_requests_mailbox on public.agent_reply_requests(mailbox_id,status,last_checked_at);
create unique index agent_reply_requests_active_scope on public.agent_reply_requests(user_id,scope_key)
where status in ('preparing','sending','waiting','uncertain');

-- A worker cannot race cancellation, create duplicate tasks, or resurrect a wait.
create function public.finish_agent_reply_request(p_id uuid,p_user_id uuid,p_revision integer,p_outcome text,p_evidence jsonb,p_notes text,p_thread_url text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare r public.agent_reply_requests; v_title text; v_message text;
begin
  select * into r from public.agent_reply_requests where id=p_id and user_id=p_user_id for update;
  if not found or r.revision<>p_revision then return false; end if;
  if p_outcome='received' then
    if r.status<>'waiting' or r.expires_at<=now() then return false; end if;
    if p_evidence is null or jsonb_typeof(p_evidence)<>'object'
       or nullif(r.message_id,'') is null or r.waiting_since is null
       or coalesce(lower(p_evidence->>'sender'),'')<>r.recipient or coalesce((p_evidence->>'automaticResponse')::boolean,true)
       or nullif(p_evidence->>'messageId','') is null
       or nullif(p_evidence->>'timestamp','') is null
       or (p_evidence->>'timestamp')::timestamptz<r.waiting_since
       or (p_evidence->>'timestamp')::timestamptz>r.expires_at
       or not coalesce((lower(p_evidence->>'inReplyTo')=lower(r.message_id) or coalesce(p_evidence->'references','[]'::jsonb) ? lower(r.message_id)),false)
    then return false; end if;
    v_title:=r.task_title;
    v_message:='Customer replied: ' || r.company_name || '. Review the reply and continue: ' || r.task_title;
  elsif p_outcome='expired' then
    if r.status<>'waiting' or r.expires_at>now() then return false; end if;
    v_title:=left('Follow up: ' || r.task_title,200);
    v_message:='Waiting period ended without a confirmed reply: ' || r.company_name || '. Review before following up.';
  elsif p_outcome='uncertain' then
    if r.status not in ('sending','uncertain') then return false; end if;
    v_title:=left('Check email delivery: ' || r.task_title,200);
    v_message:='Email delivery needs review for ' || r.company_name || '. Check Sent before sending again.';
  else raise exception 'Unsupported reply request transition'; end if;
  -- Recheck live membership, mailbox and assignment inside the transaction.
  -- The server worker checks Auth suspension using the admin Auth API;
  -- service_role deliberately has no direct access to auth.users.
  if not exists(select 1 from public.workspace_members m
    where m.user_id=r.user_id and m.role=r.owner_role and m.activated_at is not null)
    or not exists(select 1 from public.workspace_mailboxes b where b.id=r.mailbox_id and b.is_active
      and (b.type='workspace' or b.user_id=r.user_id)
      and (r.owner_role<>'bd_manager' or b.type='personal' or exists(select 1 from public.pipeline p where p.company_id=r.company_id and p.owner_id=r.user_id)))
    or not exists(select 1 from public.contacts c where c.company_id=r.company_id and lower(c.email)=r.recipient)
  then
    update public.agent_reply_requests set status='blocked',revision=revision+1,last_error='Mailbox, membership or customer access changed.',updated_at=now() where id=r.id;
    return false;
  end if;
  insert into public.crm_tasks(id,company_id,assigned_to,title,notes,priority,status,due_at)
    values(r.id,r.company_id,r.user_id,v_title,left(p_notes,24000),r.task_priority,'open',null)
    on conflict(id) do nothing;
  insert into public.internal_notifications(id,user_id,message,conversation_id,include_thread_link,task_id)
    values(r.id,r.user_id,left(v_message,500),p_thread_url,false,r.id) on conflict(id) do nothing;
  update public.agent_reply_requests set status=p_outcome,revision=revision+1,reply_evidence=p_evidence,
    task_id=r.id,last_checked_at=now(),updated_at=now() where id=r.id;
  return true;
end;
$$;
revoke all on function public.finish_agent_reply_request(uuid,uuid,integer,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.finish_agent_reply_request(uuid,uuid,integer,text,jsonb,text,text) to service_role;

-- Reuse the existing Vault-held worker origin/credential. Enable after deployment.
select cron.schedule('filazoo-customer-replies','* * * * *',$job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name='flow_cron_origin') || '/api/cron/customer-replies',
    headers := jsonb_build_object('Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='flow_cron_secret')),
    timeout_milliseconds := 240000
  );
$job$);
select cron.alter_job(jobid,active:=false) from cron.job where jobname='filazoo-customer-replies';
notify pgrst,'reload schema';
commit;
