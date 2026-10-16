begin;

alter table public.email_inbox_state
  add column if not exists is_read boolean not null default false;

notify pgrst, 'reload schema';

commit;
