-- An AI mailbox assessment cannot become a customer tag without an exact CRM contact match.
create function public.guard_ai_customer_tag() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare linked_company uuid;
begin
  if new.source <> 'ai' or new.tag is null then return new; end if;
  select c.company_id into linked_company from public.contacts c
    where lower(c.email::text)=lower(btrim(new.contact_email)) limit 1;
  if linked_company is null then new.tag := null;
  elsif new.company_id is null then new.company_id := linked_company;
  elsif new.company_id <> linked_company then new.tag := null;
  end if;
  return new;
end $$;
revoke all on function public.guard_ai_customer_tag() from public,anon,authenticated;
grant execute on function public.guard_ai_customer_tag() to service_role;
create trigger crm_email_tags_guard_ai_company before insert or update of source,tag,contact_email,company_id
  on public.crm_email_tags for each row execute function public.guard_ai_customer_tag();

-- Preserve the rejected AI evidence for diagnosis, but remove its unrelated purchasing label.
with unrelated as (
  select message_key from public.crm_email_tags t where source='ai' and company_id is null and tag is not null
    and not exists(select 1 from public.contacts c where lower(c.email::text)=lower(t.contact_email))
)
update public.crm_conversation_tag_analysis a set tag=null,
  reason='Discarded an unrelated mailbox notification: its sender is not a matched CRM customer.',
  last_cost_metrics=last_cost_metrics || '{"invalidated":"unmatched_customer"}'::jsonb
where a.conversation_key in (select message_key from unrelated);
update public.crm_email_tags t set tag=null,updated_at=now() where source='ai' and company_id is null and tag is not null
  and not exists(select 1 from public.contacts c where lower(c.email::text)=lower(t.contact_email));
update public.crm_email_tags t set company_id=c.company_id from public.contacts c
  where t.company_id is null and lower(t.contact_email)=lower(c.email::text);

create function public.backfill_untouched_lead_inquiry_tags() returns integer
language plpgsql security invoker set search_path = '' as $$
declare inserted integer;
begin
  -- Null tombstones and current assignments must win over this repair, including concurrent edits.
  lock table public.crm_email_tags in share row exclusive mode;
  with contacts_by_company as (
    select lower(email::text) email,company_id,id from public.contacts
  ), activity as (
    select c.company_id,max(e.created_at) last_at from contacts_by_company c join public.emails e on e.contact_id=c.id group by c.company_id
    union all
    select c.company_id,max(m.sent_at) from contacts_by_company c join public.mailbox_sent_messages m on lower(m.to_email)=c.email
      where m.status='sent' group by c.company_id
    union all
    select c.company_id,max((m->>'timestamp')::timestamptz)
      from public.mailbox_sync_state s cross join lateral jsonb_array_elements(s.messages) m
      join contacts_by_company c on lower(btrim(m->>'contact'))=c.email
      where m->>'timestamp' is not null and coalesce(m->>'providerRemoved','false')<>'true'
        and coalesce(m->>'providerKind','')<>'drafts' group by c.company_id
  ), last_activity as (
    select company_id,max(last_at) last_at from activity group by company_id
  ), origins as (
    select 'conversation:shopify:'||webhook_id message_key,company_id,email::text email,created_at
      from public.shopify_leads where status='processed' and company_id is not null
    union all
    select 'conversation:meta-lead:'||leadgen_id,company_id,email,created_at from public.meta_leads where company_id is not null
  )
  insert into public.crm_email_tags(message_key,company_id,contact_email,tag,source,updated_at)
    select o.message_key,o.company_id,lower(o.email),'New Inquiries','rule',o.created_at
    from origins o left join last_activity a on a.company_id=o.company_id
    where not exists(select 1 from public.crm_email_tags t where t.message_key=o.message_key)
      and not exists(select 1 from public.crm_email_tags t where t.company_id=o.company_id and t.tag is not null)
      and not exists(select 1 from public.invoices i where i.company_id=o.company_id)
      and not exists(select 1 from public.purchase_orders p where p.company_id=o.company_id)
      and (a.last_at is null or a.last_at<=o.created_at)
    on conflict(message_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;
revoke all on function public.backfill_untouched_lead_inquiry_tags() from public,anon,authenticated;
grant execute on function public.backfill_untouched_lead_inquiry_tags() to service_role;

select public.backfill_untouched_lead_inquiry_tags();
