-- Independent WeChat bridge grants; no WeChat tokens or raw identities stored.
create table public.wechat_login_grants (
  code_hash text primary key check (code_hash ~ '^[A-Za-z0-9_-]{43}$'),
  challenge text not null check (challenge ~ '^[A-Za-z0-9_-]{43}$'),
  subject text not null check (subject ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default now(),
  code_expires_at timestamptz not null default now() + interval '2 minutes',
  redeemed_at timestamptz,
  access_hash text unique check (access_hash ~ '^[A-Za-z0-9_-]{43}$'),
  access_expires_at timestamptz
);
alter table public.wechat_login_grants enable row level security;
revoke all on public.wechat_login_grants from public, anon, authenticated;
grant select, insert, update, delete on public.wechat_login_grants to service_role;
create policy wechat_login_server_access on public.wechat_login_grants
  for all to service_role using (true) with check (true);
create index wechat_login_grants_expiry on public.wechat_login_grants (created_at);

-- Conditional UPDATE serializes concurrent redemption and prevents replay.
create function public.redeem_wechat_login_code(p_code_hash text, p_challenge text, p_access_hash text)
returns table(subject text)
language sql security invoker set search_path = '' as $$
  update public.wechat_login_grants as g
  set redeemed_at = now(), access_hash = p_access_hash, access_expires_at = now() + interval '5 minutes'
  where g.code_hash = p_code_hash and g.challenge = p_challenge
    and g.redeemed_at is null and g.code_expires_at > now()
  returning g.subject;
$$;
revoke all on function public.redeem_wechat_login_code(text,text,text) from public, anon, authenticated;
grant execute on function public.redeem_wechat_login_code(text,text,text) to service_role;
