begin;

alter table public.mailbox_sent_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array');

insert into storage.buckets (id, name, public, file_size_limit)
values ('mailbox-attachments', 'mailbox-attachments', false, 7500000)
on conflict (id) do nothing;

notify pgrst, 'reload schema';

commit;
