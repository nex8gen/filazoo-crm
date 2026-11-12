-- Enrollment belongs to the reviewed action, never to a customer category.
alter table public.email_message_followups
  add column purpose text not null default 'followup',
  add constraint email_message_followups_purpose_check
    check (purpose = 'followup' or (purpose = 'nurture' and kind = 'ai'));
