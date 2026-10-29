create table public.email_footers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  text text not null default '' check (char_length(text) <= 10000),
  html text not null default '' check (char_length(html) <= 100000),
  updated_at timestamptz not null default now()
);
alter table public.email_footers enable row level security;
revoke all on public.email_footers from anon, authenticated;
grant all on public.email_footers to service_role;

-- Preserve existing per-user text signatures, escaping them before HTML use.
insert into public.email_footers (user_id, text, html)
select id, signature, '<div>' || replace(replace(replace(replace(signature, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), E'\n', '<br>') || '</div>'
from (
  select id, left(trim(coalesce(raw_user_meta_data->'crm_preferences'->>'emailSignature', '')), 2000) as signature from auth.users
) existing where signature <> ''
on conflict (user_id) do nothing;
