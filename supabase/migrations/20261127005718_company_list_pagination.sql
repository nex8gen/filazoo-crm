begin;
set local lock_timeout = '5s';

-- Private server RPC: RLS scopes every source to the current workspace. The
-- authenticated application supplies p_owner for BD managers before calling it.
create function public.crm_company_list_page(
  p_owner uuid default null, p_rules jsonb default '{}', p_segment text default null,
  p_query text default '', p_country text default 'all', p_tag text default 'all',
  p_sort text default 'createdAt', p_desc boolean default true,
  p_page integer default 1, p_size integer default 25, p_as_of timestamptz default now()
) returns jsonb language sql stable security invoker set search_path='' as $$
with audience as materialized (
  select c.id,c.name,c.created_at,coalesce(c.discovered_at,c.created_at) added_at,
    coalesce(nullif(c.country,''),'Unknown') country,
    coalesce(nullif(c.segment,''),'Unclassified') segment,
    coalesce(nullif(c.domain::text,''),c.website,'No domain') domain,
    coalesce(ct.email::text,'') email,
    case when p.owner_id is null then 'Unassigned' else coalesce(nullif(wm.display_name,''),'BD Sales Manager') end owner_name,
    tags.values as tags
  from public.companies c
  left join public.pipeline p on p.workspace_id=c.workspace_id and p.company_id=c.id
  left join public.workspace_members wm on wm.workspace_id=c.workspace_id and wm.user_id=p.owner_id
  left join public.company_profiles cp on cp.workspace_id=c.workspace_id and cp.company_id=c.id
  left join public.crm_customer_tag_state s on s.workspace_id=c.workspace_id and s.company_id=c.id
  left join lateral (select t.email from public.contacts t where t.workspace_id=c.workspace_id and t.company_id=c.id order by t.created_at,t.id limit 1) ct on true
  cross join lateral (
    -- Match projectCustomerTags: retain manual/flow overrides, suppress stale
    -- communication and commercial assignments when a current rule state exists.
    select coalesce(array_agg(distinct normalized) filter(where normalized in (
      'Prospect Nurturing','New Inquiries','Quotation Follow-up','Active Negotiations',
      'Payment Follow-up','Orders in Fulfillment','Repeat Customers','Inactive Customers',
      'Contacted — waiting for customer','Customer replied')),'{}'::text[]) values
    from (
      select case when t.tag in ('Long-term Inactive Customers','Postponed Purchasing') then 'Inactive Customers' else t.tag end normalized
      from public.crm_email_tags t where t.workspace_id=c.workspace_id and t.company_id=c.id
        and (s.company_id is null or s.facts->>'version' is distinct from 'rules-v1' or t.source in ('manual','flow') or (
          t.tag not in ('Payment Follow-up','Orders in Fulfillment','Repeat Customers','Contacted — waiting for customer','Customer replied')
          and (t.tag<>'New Inquiries' or not exists (
            select 1 from jsonb_array_elements(s.communication) item
            where item->>'status'<>'new' and (item->'keys') ? t.message_key))))
      union all select unnest(s.tags) where s.company_id is not null and s.facts->>'version'='rules-v1'
    ) projected
  ) tags
  where c.workspace_id=(select crm_tenancy.workspace_id()) and c.source is distinct from 'sample_seed'
    and (p_owner is null or p.owner_id=p_owner)
    and (p_segment is null or coalesce(nullif(c.segment,''),'Unclassified')=p_segment)
    and not (p_rules ? 'stage')
    and (not (p_rules ? 'companyIds') or (p_rules->'companyIds') ? c.id::text)
    and (not (p_rules ? 'businessSegment') or coalesce(nullif(c.segment,''),'Unclassified')=p_rules->>'businessSegment')
    and (not (p_rules ? 'country') or coalesce(nullif(c.country,''),'Unknown')=p_rules->>'country')
    and (not (p_rules ? 'source') or coalesce(nullif(c.source,''),'imported')=p_rules->>'source')
    and (not (p_rules ? 'minFitScore') or coalesce(cp.fit_score,0)>=(p_rules->>'minFitScore')::integer)
    and (not (p_rules ? 'hasEmail') or (coalesce(btrim(ct.email::text),'')<>'')=(p_rules->>'hasEmail')::boolean)
), filtered as materialized (
  select * from audience a
  where (p_country='all' or a.country=p_country) and (p_tag='all' or p_tag=any(a.tags))
    and (p_query='' or position(lower(p_query) in lower(concat_ws(' ',a.name,a.domain,a.email,a.segment,a.owner_name,array_to_string(a.tags,' '))))>0)
), bounds as (
  select count(*) total, greatest(1,least(coalesce(p_page,1),greatest(1,ceil(count(*)::numeric/greatest(1,least(p_size,100)))::integer))) page,
    greatest(1,least(p_size,100)) size from filtered
), selected as (
  select a.id, row_number() over(order by
    case when not p_desc then case p_sort when 'name' then lower(a.name) when 'email' then lower(a.email) when 'ownerName' then lower(a.owner_name) when 'country' then lower(a.country) when 'segment' then lower(a.segment) end end asc,
    case when p_desc then case p_sort when 'name' then lower(a.name) when 'email' then lower(a.email) when 'ownerName' then lower(a.owner_name) when 'country' then lower(a.country) when 'segment' then lower(a.segment) end end desc,
    case when not p_desc then case when p_sort='addedAt' then a.added_at else a.created_at end end asc,
    case when p_desc then case when p_sort='addedAt' then a.added_at else a.created_at end end desc,a.id) ordinal
  from filtered a
), recent as (
  select a.*, exists(select 1 from public.invoices i where i.workspace_id=(select crm_tenancy.workspace_id()) and i.company_id=a.id
    and i.status='issued' and i.total_minor>0 and i.paid_minor>=i.total_minor) paying,
    mail.direction,mail.status
  from filtered a
  left join lateral (select e.direction,e.status from public.emails e join public.contacts ct on ct.workspace_id=e.workspace_id and ct.id=e.contact_id
    where ct.workspace_id=(select crm_tenancy.workspace_id()) and ct.company_id=a.id order by e.created_at desc,e.id desc limit 1) mail on true
  where a.added_at>=p_as_of-interval '180 days' and a.added_at<=p_as_of
), buckets as (
  select least(179,floor(extract(epoch from (added_at-(p_as_of-interval '180 days')))/86400)::integer) day_index,
    jsonb_build_array(count(*),
      count(*) filter(where direction is not null or tags && array['Contacted — waiting for customer','Customer replied']),
      count(*) filter(where direction='received' or 'Customer replied'=any(tags)),
      count(*) filter(where tags && array['New Inquiries','Quotation Follow-up','Active Negotiations','Payment Follow-up']),
      count(*) filter(where paying)) counts
  from recent group by 1
)
select jsonb_build_object(
  'ids',coalesce((select jsonb_agg(s.id order by ordinal) from selected s where ordinal>(b.page-1)*b.size and ordinal<=b.page*b.size),'[]'::jsonb),
  'total',b.total,'page',b.page,
  'countries',coalesce((select jsonb_agg(country order by country) from (select distinct country from audience) c),'[]'::jsonb),
  'segments',coalesce((select jsonb_agg(segment order by segment) from (select distinct segment from public.companies c
    where c.workspace_id=(select crm_tenancy.workspace_id()) and c.source is distinct from 'sample_seed'
      and c.segment is not null and c.segment<>'' and c.segment<>'Unclassified'
      and (p_owner is null or exists(select 1 from public.pipeline p where p.workspace_id=c.workspace_id and p.company_id=c.id and p.owner_id=p_owner))) s),'[]'::jsonb),
  'buckets',coalesce((select jsonb_agg(jsonb_build_object('day',day_index,'counts',counts) order by day_index) from buckets),'[]'::jsonb)
) from bounds b;
$$;
revoke all on function public.crm_company_list_page(uuid,jsonb,text,text,text,text,text,boolean,integer,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.crm_company_list_page(uuid,jsonb,text,text,text,text,text,boolean,integer,integer,timestamptz) to service_role,crm_workspace_server;
notify pgrst,'reload schema';
commit;
