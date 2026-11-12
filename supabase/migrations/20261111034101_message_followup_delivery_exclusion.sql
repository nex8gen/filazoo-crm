-- Teammates may set their own reminders, but a shared conversation gets only
-- one pending automatic follow-up, even across concurrent user requests.
create unique index email_message_followups_one_ai_delivery
  on public.email_message_followups(workspace_id,mailbox_id,thread_key)
  where kind='ai' and status in ('scheduled','processing');
