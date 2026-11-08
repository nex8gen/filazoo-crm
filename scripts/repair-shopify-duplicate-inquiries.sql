-- Retain every receipt and reply key; hide only exact short-window repeats.
-- Changed answers, later follow-ups and unlinked/failed imports remain intact.
begin;
with recursive ordered as (
  select workspace_id, webhook_id, created_at,
    dense_rank() over (order by workspace_id, shop_domain, email, form_content, company_id, contact_id) as grp,
    row_number() over (partition by workspace_id, shop_domain, email, form_content, company_id, contact_id
      order by created_at, webhook_id) as rn
  from public.shopify_leads
  where status = 'processed' and form_content is not null and duplicate_of is null
    and company_id is not null and contact_id is not null
), canonical as (
  select o.*, webhook_id as root_id, created_at as root_at from ordered o where rn = 1
  union all
  select o.*,
    case when o.created_at > c.root_at + interval '10 minutes' then o.webhook_id else c.root_id end,
    case when o.created_at > c.root_at + interval '10 minutes' then o.created_at else c.root_at end
  from ordered o join canonical c on o.grp = c.grp and o.rn = c.rn + 1
), repaired as (
  update public.shopify_leads l set duplicate_of = c.root_id
  from canonical c
  where l.workspace_id = c.workspace_id and l.webhook_id = c.webhook_id
    and c.webhook_id <> c.root_id and l.duplicate_of is null
  returning l.company_name, l.duplicate_of
)
select company_name, count(*) as linked_duplicates from repaired group by company_name order by company_name;
commit;
