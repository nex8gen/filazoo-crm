alter table public.meta_messages
  drop constraint if exists meta_messages_source_check;

alter table public.meta_messages
  add constraint meta_messages_source_check
  check (source in ('facebook_messenger', 'instagram_messaging'));
