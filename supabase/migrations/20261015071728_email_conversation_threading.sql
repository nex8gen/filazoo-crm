begin;

alter table public.mailbox_sent_messages
  add column if not exists thread_key text,
  add column if not exists in_reply_to text,
  add column if not exists reference_ids text[] not null default '{}';

create index if not exists mailbox_sent_messages_thread_key_idx
  on public.mailbox_sent_messages(user_id, thread_key);

notify pgrst, 'reload schema';

commit;
