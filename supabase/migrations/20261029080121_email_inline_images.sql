-- Retain the HTML alternative separately from searchable plain text.
alter table public.mailbox_sent_messages add column if not exists body_html text;
comment on column public.mailbox_sent_messages.body_html is 'Original outgoing HTML with CID references to private stored attachments.';
