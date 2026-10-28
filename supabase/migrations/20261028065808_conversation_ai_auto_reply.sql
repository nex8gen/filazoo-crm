-- Conversation opt-in. All reads/writes go through authenticated server services.
create table public.email_auto_replies (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.workspace_mailboxes(id) on delete cascade,
  sender_id uuid not null references public.workspace_mailboxes(id) on delete cascade check(sender_id=mailbox_id),
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_to uuid not null references auth.users(id) on delete cascade,
  root_message_id text not null, thread_key text not null, recipient text not null,
  anchors text[] not null, history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  enabled boolean not null default false,
  status text not null default 'paused' check (status in ('active','paused','processing','waiting_shipping','ready','needs_review')),
  revision integer not null default 1,
  enabled_at timestamptz not null default now(), last_message_key text not null,
  pending_message_key text, pending_document jsonb, invoice_id uuid references public.invoices(id) on delete set null,
  task_id uuid references public.crm_tasks(id) on delete set null,
  last_error text, last_sent_at timestamptz, processing_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(mailbox_id, root_message_id)
);
create index email_auto_replies_due_idx on public.email_auto_replies(updated_at) where enabled;
create index email_auto_replies_anchors_idx on public.email_auto_replies using gin(anchors);
create index email_auto_replies_user_idx on public.email_auto_replies(user_id);
create index email_auto_replies_sender_idx on public.email_auto_replies(sender_id);
create index email_auto_replies_assignee_idx on public.email_auto_replies(assigned_to);
create index email_auto_replies_invoice_idx on public.email_auto_replies(invoice_id);
create index email_auto_replies_task_idx on public.email_auto_replies(task_id);
create trigger email_auto_replies_updated before update on public.email_auto_replies for each row execute function public.set_updated_at();

-- A durable reservation is written BEFORE SMTP. Interrupted or ambiguous sends
-- require human review and are never retried automatically.
create table public.email_auto_reply_deliveries (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.email_auto_replies(id) on delete cascade,
  message_key text not null, status text not null check (status in ('reserved','sent','failed')),
  message_id text, error text, created_at timestamptz not null default now(), sent_at timestamptz,
  unique(automation_id, message_key)
);
create table public.email_reply_knowledge (
  id uuid primary key default gen_random_uuid(), title text not null check(char_length(title) between 1 and 200),
  content text not null check(char_length(content) between 1 and 10000),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create index email_reply_knowledge_creator_idx on public.email_reply_knowledge(created_by);
alter table public.email_auto_replies enable row level security;
alter table public.email_auto_reply_deliveries enable row level security;
alter table public.email_reply_knowledge enable row level security;
revoke all on public.email_auto_replies, public.email_auto_reply_deliveries, public.email_reply_knowledge from public, anon, authenticated;
grant select, insert, update, delete on public.email_auto_replies, public.email_auto_reply_deliveries, public.email_reply_knowledge to service_role;

-- Save the pause, task and notification together, including revision protection
-- against a user stopping AI while generation was running.
create function public.handoff_email_auto_reply(
  p_id uuid, p_revision integer, p_status text, p_document jsonb, p_message_key text,
  p_history jsonb, p_reason text, p_company_id uuid default null, p_contact_id uuid default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare a public.email_auto_replies; v_task uuid;
begin
  select * into a from public.email_auto_replies where id=p_id for update;
  if a.id is null or not a.enabled or a.revision <> p_revision or a.status <> 'processing' then
    raise exception 'Automation changed or was stopped';
  end if;
  if p_status not in ('waiting_shipping','needs_review') then raise exception 'Invalid handoff'; end if;
  v_task := coalesce(a.task_id, gen_random_uuid());
  insert into public.crm_tasks(id,company_id,contact_id,assigned_to,title,notes,priority,status,due_at)
    values(v_task,p_company_id,p_contact_id,a.assigned_to,
      case when p_status='waiting_shipping' then 'Add shipping cost to send customer invoice' else 'Review AI email reply' end,
      left(p_reason,4000) || E'\nOpen conversation: /emails?mailbox=' || a.mailbox_id::text || '&thread=' || a.thread_key,
      'high','open',now())
    on conflict(id) do update set title=excluded.title,notes=excluded.notes,status='open',completed_at=null,assigned_to=excluded.assigned_to;
  insert into public.internal_notifications(user_id,message,conversation_id,include_thread_link)
    values(a.assigned_to,left(case when p_status='waiting_shipping' then 'Shipping approval required: ' else 'AI reply needs review: ' end || a.recipient || '. ' || p_reason,500),a.thread_key,true);
  update public.email_auto_replies set status=p_status,pending_document=p_document,pending_message_key=p_message_key,
    history=p_history,task_id=v_task,last_error=p_reason,processing_at=null where id=p_id;
end;
$$;
revoke all on function public.handoff_email_auto_reply(uuid,integer,text,jsonb,text,jsonb,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.handoff_email_auto_reply(uuid,integer,text,jsonb,text,jsonb,text,uuid,uuid) to service_role;
