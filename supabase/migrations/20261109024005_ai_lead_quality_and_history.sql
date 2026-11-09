-- Compact workspace memory includes candidates that failed qualification, so
-- the next search does not spend credits researching the same companies.
alter table public.ai_lead_searches add column research_summary jsonb;
create table public.ai_lead_company_history (
  workspace_id uuid not null default crm_tenancy.workspace_id() references public.workspaces(id) on delete restrict,
  domain text not null check(length(domain) between 3 and 253),
  company_name text not null,
  search_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(workspace_id,domain),
  foreign key(workspace_id,search_id) references public.ai_lead_searches(workspace_id,id) on delete cascade
);
create index ai_lead_company_history_search on public.ai_lead_company_history(workspace_id,search_id);
alter table public.ai_lead_company_history enable row level security;
revoke all on public.ai_lead_company_history from public,anon,authenticated;
grant select,insert,update,delete on public.ai_lead_company_history to crm_workspace_server,service_role;
create policy crm_workspace_isolation on public.ai_lead_company_history to crm_workspace_server
  using(workspace_id=(select crm_tenancy.workspace_id())) with check(workspace_id=(select crm_tenancy.workspace_id()));

-- Backfill every stored search, not only the twenty shown in the page history.
insert into public.ai_lead_company_history(workspace_id,domain,company_name,search_id,created_at)
select distinct on(s.workspace_id,lower(trim(trailing '.' from regexp_replace(lead->>'domain','^www\.','','i'))))
  s.workspace_id,lower(trim(trailing '.' from regexp_replace(lead->>'domain','^www\.','','i'))),coalesce(lead->>'name',''),s.id,s.created_at
from public.ai_lead_searches s cross join lateral jsonb_array_elements(s.results) lead
where length(lead->>'domain') between 3 and 253
order by s.workspace_id,lower(trim(trailing '.' from regexp_replace(lead->>'domain','^www\.','','i'))),s.created_at
on conflict(workspace_id,domain) do nothing;

notify pgrst,'reload schema';

-- Enforce the same quality gate inside the atomic CRM save.
create or replace function public.save_ai_lead(p_search_id uuid,p_lead_id text,p_actor_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.ai_lead_searches%rowtype; lead jsonb; position integer; company uuid; contact_email text; existing boolean:=false; email_conflict boolean:=false;
begin
  if not exists(select 1 from public.workspace_members where user_id=p_actor_id and activated_at is not null and role in ('admin','operator','bd_manager')) then raise insufficient_privilege; end if;
  select * into s from public.ai_lead_searches where id=p_search_id for update;
  if not found or s.status<>'complete' then raise exception 'Search is not complete'; end if;
  select value,(ordinality-1)::int into lead,position from jsonb_array_elements(s.results) with ordinality where value->>'id'=p_lead_id;
  if lead is null then raise exception 'Lead not found'; end if;
  if lead->>'qualification' is distinct from 'qualified' or lead->>'researchVersion' is distinct from '2'
    or lead->>'confidence' is distinct from 'supported'
    or coalesce(jsonb_array_length(lead->'matchedProducts'),0)=0
    or coalesce(lead->'fitEvidence','null'::jsonb)='null'::jsonb
    or coalesce(lead->'locationEvidence','null'::jsonb)='null'::jsonb
    or coalesce(lead->'buyerEvidence','null'::jsonb)='null'::jsonb
    or coalesce(lead->'identityEvidence','null'::jsonb)='null'::jsonb
    or exists(select 1 from unnest(array['product','location','buyer','requirements','identity']) required(key)
      where not exists(select 1 from jsonb_array_elements(coalesce(lead->'checks','[]'::jsonb)) check_item where check_item->>'key'=required.key and check_item->>'state'='met'))
  then raise exception 'Only evidence-qualified companies can be saved from AI Leads'; end if;

  perform pg_advisory_xact_lock(hashtextextended(s.workspace_id::text||':'||(lead->>'domain'),0));
  select id into company from public.companies where domain=(lead->>'domain');
  if company is not null then existing:=true;
  else
    insert into public.companies(name,website,domain,country,city,segment,source,source_url,status)
    values(lead->>'name',lead->>'website',lead->>'domain',nullif(lead->>'country',''),nullif(lead->>'city',''),coalesce(nullif(lead->>'segment',''),'Prospect'),'ai_discovery',lead->>'website','new') returning id into company;
    insert into public.pipeline(company_id,owner_id) values(company,p_actor_id);
    insert into public.customer_billing_profiles(company_id,profile)
      values(company,jsonb_strip_nulls(jsonb_build_object('phone',lead->'phones'->0->>'value','address',lead->'address'->>'value')))
      on conflict(workspace_id,company_id) do nothing;
    insert into public.company_profiles(company_id,summary,fit_score,interest_tags)
      values(company,lead->>'summary',greatest(1,least(case when jsonb_array_length(lead->'matchedProducts')>0 and lead->>'confidence'='supported' then 10 else 4 end,ceil((lead->>'fitScore')::numeric/10)::integer)),array(select jsonb_array_elements_text(lead->'matchedProducts')));
    -- Keep all emails and phones with sources in the audit event. Save published
    -- email addresses as unverified; they never acquire inquiry/opt-in status.
    for contact_email in select value->>'value' from jsonb_array_elements(lead->'emails') loop
      if exists(select 1 from public.contacts where email=contact_email) then email_conflict:=true;
      else
        insert into public.contacts(company_id,email,name,role,verification_status,consent_source)
          values(company,contact_email,
            case when position(lower(contact_email) in lower(lead->'contactName'->>'quote'))>0 then lead->'contactName'->>'value' else null end,
            case when position(lower(contact_email) in lower(lead->'contactRole'->>'quote'))>0 then lead->'contactRole'->>'value' else null end,
            'unverified','public_website_research');
      end if;
    end loop;
    insert into public.events(company_id,actor_id,type,data) values(company,p_actor_id,'company_created',jsonb_build_object('summary','Added from AI lead discovery. Public contacts are unverified.','searchId',s.id,'leadResearch',lead,'emailConflict',email_conflict));
  end if;
  update public.ai_lead_searches set results=jsonb_set(results,array[position::text,'savedCompanyId'],to_jsonb(company::text)),updated_at=now() where id=s.id;
  return jsonb_build_object('companyId',company,'existing',existing,'emailConflict',email_conflict);
end $$;
revoke all on function public.save_ai_lead(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.save_ai_lead(uuid,text,uuid) to crm_workspace_server,service_role;
notify pgrst,'reload schema';
