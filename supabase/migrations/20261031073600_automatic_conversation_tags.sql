-- Background AI can change only conversation tags, never send or approve a payment.
alter table public.crm_email_tags add column source text not null default 'manual'
  check (source in ('manual', 'flow', 'ai'));

create table public.crm_conversation_tag_analysis (
  conversation_key text primary key check (length(conversation_key) between 1 and 512),
  input_hash text not null,
  latest_message_at timestamptz not null,
  message_count integer not null check (message_count > 0),
  lease_token uuid,
  lease_until timestamptz,
  claimed_at timestamptz not null default now(),
  checked_at timestamptz not null default now(),
  retry_at timestamptz,
  status text not null default 'processing' check (status in ('processing', 'done', 'failed', 'manual')),
  tag text,
  confidence numeric check (confidence between 0 and 1),
  reason text,
  evidence jsonb not null default '[]'::jsonb
);
alter table public.crm_conversation_tag_analysis enable row level security;
revoke all on public.crm_conversation_tag_analysis from anon, authenticated;
grant all on public.crm_conversation_tag_analysis to service_role;

-- Cache + expiring ownership: concurrent cron/poll requests never analyze the same input twice.
create function public.claim_conversation_tag_analysis(p_key text, p_hash text, p_latest timestamptz, p_count integer, p_token uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed text;
begin
  insert into public.crm_conversation_tag_analysis as existing
    (conversation_key, input_hash, latest_message_at, message_count, lease_token, lease_until)
  values (p_key, p_hash, p_latest, p_count, p_token, now() + interval '3 minutes')
  on conflict (conversation_key) do update set input_hash = excluded.input_hash,
    latest_message_at = excluded.latest_message_at, message_count = excluded.message_count,
    lease_token = p_token, lease_until = now() + interval '3 minutes', claimed_at = now(),
    checked_at = now(), status = 'processing', retry_at = null
  where (existing.lease_until is null or existing.lease_until < now())
    and excluded.latest_message_at >= existing.latest_message_at
    and (excluded.latest_message_at > existing.latest_message_at or excluded.message_count >= existing.message_count)
    and (existing.input_hash <> excluded.input_hash or
      (existing.status in ('failed', 'processing') and coalesce(existing.retry_at, '-infinity'::timestamptz) <= now()))
  returning conversation_key into claimed;
  return claimed is not null;
end $$;

create function public.finish_conversation_tag_analysis(
  p_key text, p_token uuid, p_keys text[], p_message_keys text[], p_contact text,
  p_tag text, p_confidence numeric, p_reason text, p_evidence jsonb, p_error boolean default false)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare job public.crm_conversation_tag_analysis; company uuid; target text; manual_override boolean; access jsonb;
begin
  select * into job from public.crm_conversation_tag_analysis
    where conversation_key = p_key and lease_token = p_token and lease_until > now() for update;
  if not found then return false; end if;
  -- Recheck permissions at the transaction boundary, after the provider returned.
  select policy into access from public.workspace_ai_settings where singleton = true for share;
  if not coalesce((access->>'enabled')::boolean, false)
    or not coalesce((access#>>'{features,automation}')::boolean, false)
    or not coalesce((access#>>'{features,email}')::boolean, false)
    or not coalesce((access#>>'{data,emails}')::boolean, false)
    or not coalesce((access#>>'{data,customers}')::boolean, false)
    or coalesce(access#>>'{actions,tagging}', '') <> 'auto' then
    p_error := true; p_tag := null; p_reason := 'Automatic conversation tagging is paused by AI settings.';
  end if;
  -- Serialize only the short commit against manual/flow edits, including previously absent aliases.
  lock table public.crm_email_tags in share row exclusive mode;
  select exists(select 1 from public.crm_email_tags
    where message_key = any(p_keys || p_message_keys) and source <> 'ai'
      and updated_at >= least(job.claimed_at, job.latest_message_at)) into manual_override;
  if p_tag is not null and p_confidence >= 0.85 and not p_error and not manual_override then
    select company_id into company from public.contacts where lower(email) = lower(p_contact) limit 1;
    for target in select distinct unnest(p_keys || p_message_keys) loop
      insert into public.crm_email_tags(message_key, company_id, contact_email, tag, source, updated_at)
      values(target, company, lower(p_contact), case when target = any(p_keys) then p_tag else null end, 'ai', now())
      on conflict(message_key) do update set company_id = coalesce(excluded.company_id, crm_email_tags.company_id),
        contact_email = excluded.contact_email, tag = excluded.tag, source = 'ai', updated_at = now();
    end loop;
  end if;
  update public.crm_conversation_tag_analysis set
    status = case when p_error then 'failed' when manual_override then 'manual' else 'done' end,
    tag = p_tag, confidence = p_confidence, reason = left(p_reason, 800), evidence = p_evidence,
    lease_token = null, lease_until = null, checked_at = now(),
    retry_at = case when p_error then now() + interval '15 minutes' else null end
    where conversation_key = p_key;
  return true;
end $$;

revoke all on function public.claim_conversation_tag_analysis(text,text,timestamptz,integer,uuid) from public, anon, authenticated;
revoke all on function public.finish_conversation_tag_analysis(text,uuid,text[],text[],text,text,numeric,text,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.claim_conversation_tag_analysis(text,text,timestamptz,integer,uuid) to service_role;
grant execute on function public.finish_conversation_tag_analysis(text,uuid,text[],text[],text,text,numeric,text,jsonb,boolean) to service_role;

-- Explicitly requested in this workspace; every other AI action keeps its current approval mode.
update public.workspace_ai_settings set policy = jsonb_set(policy, '{actions,tagging}', '"auto"'::jsonb, true),
  revision = revision + 1, updated_at = now() where singleton = true;
