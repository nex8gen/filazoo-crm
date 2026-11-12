-- One explicitly confirmed action for a mailbox conversation, isolated by workspace.
create table public.email_message_followups (
  id uuid not null,
  workspace_id uuid not null default crm_tenancy.workspace_id() references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mailbox_id text not null,
  message_key text not null,
  message_id text not null,
  thread_key text not null,
  conversation_url text not null,
  recipient text not null,
  anchors text[] not null,
  message_keys text[] not null default '{}',
  baseline text[] not null,
  context_at timestamptz not null,
  kind text not null check(kind in ('reminder','ai')),
  due_at timestamptz not null,
  subject text not null check(length(subject) between 1 and 300),
  body text not null default '' check(length(body)<=20000),
  status text not null default 'scheduled' check(status in ('scheduled','processing','reminded','sent','cancelled','failed','uncertain')),
  revision integer not null default 1 check(revision>0),
  delivery_id uuid not null default gen_random_uuid(),
  error text,
  task_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(workspace_id,id),
  foreign key(workspace_id,task_id) references public.crm_tasks(workspace_id,id) on delete set null(task_id),
  unique(workspace_id,user_id,mailbox_id,thread_key),
  check(kind<>'ai' or length(body)>0)
);
create index email_message_followups_due on public.email_message_followups(workspace_id,due_at) where status='scheduled';
create index email_message_followups_processing on public.email_message_followups(workspace_id,updated_at) where status='processing';
create index email_message_followups_anchors on public.email_message_followups using gin(anchors);
alter table public.email_message_followups enable row level security;
revoke all on public.email_message_followups from public,anon,authenticated;
grant select,insert,update,delete on public.email_message_followups to crm_workspace_server,service_role;
create policy crm_workspace_isolation on public.email_message_followups to crm_workspace_server
  using(workspace_id=(select crm_tenancy.workspace_id())) with check(workspace_id=(select crm_tenancy.workspace_id()));

-- Save the reminder, its task, and the inbox marker in the same transaction.
create function public.sync_email_message_followup() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_task uuid; v_link text;
begin
  if tg_op='UPDATE' then
    if new.status='scheduled' and old.status='scheduled' and new.revision=old.revision then return new; end if;
    if old.task_id is not null and (new.kind<>'reminder' or new.status not in ('scheduled','reminded')) then
      update public.crm_tasks set status='cancelled' where workspace_id=old.workspace_id and id=old.task_id and status='open';
    end if;
    if old.message_key<>new.message_key or new.status not in ('scheduled','processing','reminded') then
      update public.email_inbox_state set follow_up_at=null
      where workspace_id=old.workspace_id and user_id=old.user_id and message_key=old.message_key and follow_up_at=old.due_at;
    end if;
  end if;
  if new.status in ('scheduled','processing','reminded') then
    update public.email_inbox_state set follow_up_at=null where workspace_id=new.workspace_id and user_id=new.user_id
      and message_key=any(new.message_keys) and message_key<>new.message_key and follow_up_at is not null;
    insert into public.email_inbox_state(workspace_id,user_id,message_key,follow_up_at)
      values(new.workspace_id,new.user_id,new.message_key,new.due_at)
      on conflict(workspace_id,user_id,message_key) do update set follow_up_at=excluded.follow_up_at;
  end if;
  if new.kind='reminder' and new.status='scheduled' then
    v_task:=coalesce(new.task_id,gen_random_uuid());
    v_link:=new.conversation_url;
    insert into public.crm_tasks(id,workspace_id,assigned_to,title,notes,due_at)
      values(v_task,new.workspace_id,new.user_id,left('Follow up: '||new.subject,200),'Mailbox reminder for '||new.recipient||E'\nOpen conversation: '||v_link,new.due_at)
      on conflict(workspace_id,id) do update set title=excluded.title,notes=excluded.notes,due_at=excluded.due_at,status='open',completed_at=null;
    new.task_id:=v_task;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_email_message_followup() from public,anon,authenticated;
grant execute on function public.sync_email_message_followup() to crm_workspace_server,service_role;
create trigger email_message_followup_activity before insert or update on public.email_message_followups
  for each row execute function public.sync_email_message_followup();
notify pgrst,'reload schema';
