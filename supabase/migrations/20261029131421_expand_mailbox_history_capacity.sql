alter table public.mailbox_sync_state
  drop constraint if exists mailbox_sync_state_messages_check;

alter table public.mailbox_sync_state
  add constraint mailbox_sync_state_messages_check
  check (jsonb_typeof(messages) = 'array' and jsonb_array_length(messages) <= 5000);
