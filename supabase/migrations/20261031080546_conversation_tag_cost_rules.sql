-- Fixed intake rule: a successfully imported Shopify/Meta lead begins as New Inquiries.
-- It does not depend on AI availability or on words in an incoming email.
alter table public.crm_email_tags drop constraint crm_email_tags_source_check;
alter table public.crm_email_tags add constraint crm_email_tags_source_check check (source in ('manual','flow','ai','rule'));

create function public.tag_imported_lead_inquiry() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare key text;
begin
  if new.company_id is null then return new; end if;
  if tg_table_name = 'shopify_leads' then
    if new.status <> 'processed' then return new; end if;
    if tg_op = 'UPDATE' then
      if old.status = 'processed' and old.company_id is not null then return new; end if;
    end if;
    key := 'conversation:shopify:' || new.webhook_id;
  else
    if tg_op = 'UPDATE' then
      if old.company_id is not null then return new; end if;
    end if;
    key := 'conversation:meta-lead:' || new.leadgen_id;
  end if;
  insert into public.crm_email_tags(message_key, company_id, contact_email, tag, source)
    values(key, new.company_id, lower(new.email::text), 'New Inquiries', 'rule')
    on conflict(message_key) do nothing;
  return new;
end $$;
revoke all on function public.tag_imported_lead_inquiry() from public, anon, authenticated;
grant execute on function public.tag_imported_lead_inquiry() to service_role;
create trigger shopify_lead_initial_inquiry after insert or update of status,company_id on public.shopify_leads
  for each row execute function public.tag_imported_lead_inquiry();
create trigger meta_lead_initial_inquiry after insert or update of company_id on public.meta_leads
  for each row execute function public.tag_imported_lead_inquiry();

alter table public.crm_conversation_tag_analysis
  add column attempts integer not null default 0 check (attempts >= 0),
  add column last_cost_metrics jsonb not null default '{}'::jsonb;

-- Coalesce rapid replies: at most one analysis attempt per conversation per minute,
-- including callers racing after another worker has just finished.
create or replace function public.claim_conversation_tag_analysis(p_key text, p_hash text, p_latest timestamptz, p_count integer, p_token uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed text;
begin
  insert into public.crm_conversation_tag_analysis as existing
    (conversation_key, input_hash, latest_message_at, message_count, lease_token, lease_until, attempts)
  values (p_key, p_hash, p_latest, p_count, p_token, now() + interval '3 minutes', 1)
  on conflict (conversation_key) do update set input_hash = excluded.input_hash,
    latest_message_at = excluded.latest_message_at, message_count = excluded.message_count,
    lease_token = p_token, lease_until = now() + interval '3 minutes', claimed_at = now(),
    checked_at = now(), status = 'processing', retry_at = null,
    attempts = case when existing.input_hash = excluded.input_hash then existing.attempts + 1 else 1 end
  where (existing.lease_until is null or existing.lease_until < now())
    and existing.checked_at <= now() - interval '1 minute'
    and excluded.latest_message_at >= existing.latest_message_at
    and (excluded.latest_message_at > existing.latest_message_at or excluded.message_count >= existing.message_count)
    and (existing.input_hash <> excluded.input_hash or
      (existing.status in ('failed', 'processing') and coalesce(existing.retry_at, '-infinity'::timestamptz) <= now()))
  returning conversation_key into claimed;
  return claimed is not null;
end $$;

create function public.finish_conversation_tag_analysis_with_metrics(
  p_key text, p_token uuid, p_keys text[], p_message_keys text[], p_contact text,
  p_tag text, p_confidence numeric, p_reason text, p_evidence jsonb,
  p_error boolean, p_metrics jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare completed boolean;
begin
  if jsonb_typeof(p_metrics) <> 'object' or octet_length(p_metrics::text) > 2048 then raise exception 'Invalid analysis metrics'; end if;
  completed := public.finish_conversation_tag_analysis(p_key,p_token,p_keys,p_message_keys,p_contact,p_tag,p_confidence,p_reason,p_evidence,p_error);
  if completed then
    update public.crm_conversation_tag_analysis set last_cost_metrics = p_metrics,
      retry_at = case when status = 'failed' then now() + case
        when attempts <= 1 then interval '15 minutes'
        when attempts = 2 then interval '1 hour'
        when attempts = 3 then interval '6 hours'
        else interval '24 hours' end else retry_at end
      where conversation_key = p_key;
  end if;
  return completed;
end $$;
revoke all on function public.finish_conversation_tag_analysis_with_metrics(text,uuid,text[],text[],text,text,numeric,text,jsonb,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.finish_conversation_tag_analysis_with_metrics(text,uuid,text[],text[],text,text,numeric,text,jsonb,boolean,jsonb) to service_role;
