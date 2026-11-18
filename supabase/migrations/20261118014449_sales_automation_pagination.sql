create or replace function public.crm_dormant_customers(p_user_id uuid, p_months integer, p_company_id uuid default null, p_after uuid default null)
returns table(company_id uuid, contact_id uuid, last_activity_at timestamptz, eligible boolean)
language sql stable security invoker set search_path='' as $$
  with owned as (
    select c.id, p.next_followup_at from public.companies c
    join public.pipeline p on p.workspace_id=c.workspace_id and p.company_id=c.id and p.owner_id=p_user_id
    where c.workspace_id=(select crm_tenancy.workspace_id()) and c.status<>'disqualified'
      and (p_company_id is null or c.id=p_company_id) and (p_after is null or c.id>p_after)
  ), facts as (
    select c.id, c.next_followup_at, chosen.id as contact_id,
      greatest(mail.last_at, purchases.last_at) as last_at,
      purchases.has_open, (quotes.has_quote or purchases.last_at is not null) as known_customer
    from owned c
    join lateral (select ct.id from public.contacts ct where ct.workspace_id=(select crm_tenancy.workspace_id())
      and ct.company_id=c.id and not ct.unsubscribed and ct.email is not null
      and not exists(select 1 from public.suppression s where s.workspace_id=ct.workspace_id and lower(s.email)=lower(ct.email))
      order by ct.created_at,ct.id limit 1) chosen on true
    left join lateral (select max(coalesce(e.sent_at,e.created_at)) as last_at from public.emails e
      join public.contacts ct on ct.workspace_id=e.workspace_id and ct.id=e.contact_id
      where e.workspace_id=(select crm_tenancy.workspace_id()) and ct.company_id=c.id
      and e.status in ('sent','received') and not e.automatic_response
      and (e.direction='received' or not exists(select 1 from public.flow_run_logs l
        where l.workspace_id=e.workspace_id and l.result->>'action'='email_sent'
        and l.result->>'messageId'=e.message_id))) mail on true
    left join lateral (select max(o.created_at) filter(where o.document->>'status' not in ('draft','cancelled')) as last_at,
      coalesce(bool_or(o.document->>'status' in ('confirmed','in_production','shipped')),false) as has_open
      from public.purchase_orders o where o.workspace_id=(select crm_tenancy.workspace_id()) and o.company_id=c.id) purchases on true
    left join lateral (select exists(select 1 from public.catalogs q where q.workspace_id=(select crm_tenancy.workspace_id())
      and q.company_id=c.id and q.quote_status in ('shared','accepted')) as has_quote) quotes on true
  )
  select f.id, f.contact_id, f.last_at,
    f.known_customer and not f.has_open and f.last_at is not null
    and f.last_at<=now()-make_interval(months=>greatest(1,least(p_months,24)))
    and (f.next_followup_at is null or f.next_followup_at<=now())
    and not exists(select 1 from public.email_message_followups pending join public.contacts ct
      on ct.workspace_id=pending.workspace_id and lower(ct.email)=lower(pending.recipient)
      where pending.workspace_id=(select crm_tenancy.workspace_id()) and ct.company_id=f.id
      and pending.status in ('scheduled','processing','uncertain'))
    and not exists(select 1 from public.email_auto_replies active join public.contacts ct
      on ct.workspace_id=active.workspace_id and lower(ct.email)=lower(active.recipient)
      where active.workspace_id=(select crm_tenancy.workspace_id()) and ct.company_id=f.id and active.enabled)
  from facts f order by f.id limit 100;
$$;

notify pgrst,'reload schema';



