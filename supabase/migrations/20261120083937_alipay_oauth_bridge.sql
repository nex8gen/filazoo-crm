-- OAuth bridge: opaque grants are short lived, hashed and server-only.
create table public.alipay_login_grants (
  code_hash text primary key check (length(code_hash) = 43),
  challenge text not null check (length(challenge) = 43),
  subject text not null check (length(subject) = 43),
  created_at timestamptz not null default now(),
  code_expires_at timestamptz not null default now() + interval '2 minutes',
  redeemed_at timestamptz,
  access_hash text unique,
  access_expires_at timestamptz
);
alter table public.alipay_login_grants enable row level security;
revoke all on public.alipay_login_grants from public, anon, authenticated;
grant select, insert, update, delete on public.alipay_login_grants to service_role;
create index alipay_login_grants_expiry on public.alipay_login_grants (created_at);

-- Conditional UPDATE serializes simultaneous code redemption. Failed client,
-- redirect and PKCE checks never consume another browser's grant.
create function public.redeem_alipay_login_code(p_code_hash text, p_challenge text, p_access_hash text)
returns table(subject text)
language sql security invoker set search_path = '' as $$
  update public.alipay_login_grants as g
  set redeemed_at = now(), access_hash = p_access_hash, access_expires_at = now() + interval '5 minutes'
  where g.code_hash = p_code_hash and g.challenge = p_challenge
    and g.redeemed_at is null and g.code_expires_at > now()
  returning g.subject;
$$;
revoke all on function public.redeem_alipay_login_code(text,text,text) from public, anon, authenticated;
grant execute on function public.redeem_alipay_login_code(text,text,text) to service_role;
