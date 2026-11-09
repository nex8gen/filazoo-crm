-- Public lead research is tenant-scoped and never sends outreach.
create table public.ai_lead_searches (
  workspace_id uuid not null default crm_tenancy.workspace_id() references public.workspaces(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  request_id uuid not null,
  created_by uuid not null references auth.users(id),
  criteria jsonb not null,
  products jsonb not null,
  context_key text not null,
  feedback_context jsonb not null default '[]',
  status text not null default 'queued' check(status in ('queued','running','complete','failed','cancelled')),
  phase text not null default 'Queued',
  results jsonb not null default '[]' check(jsonb_typeof(results)='array' and jsonb_array_length(results)<=10),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(workspace_id,id),
  unique(workspace_id,request_id)
);
create index ai_lead_searches_recent on public.ai_lead_searches(workspace_id,created_at desc);
create unique index ai_lead_searches_one_active on public.ai_lead_searches(workspace_id) where status in ('queued','running');
create table public.ai_lead_feedback (
  workspace_id uuid not null default crm_tenancy.workspace_id() references public.workspaces(id) on delete restrict,
  context_key text not null,
  domain text not null,
  reason text not null check(reason in ('good_match','wrong_industry','wrong_location','competitor','contact_incorrect','dismissed')),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key(workspace_id,context_key,domain)
);
alter table public.ai_lead_searches enable row level security;
alter table public.ai_lead_feedback enable row level security;
revoke all on public.ai_lead_searches,public.ai_lead_feedback from anon,authenticated;
grant select,insert,update,delete on public.ai_lead_searches,public.ai_lead_feedback to crm_workspace_server,service_role;
create policy crm_workspace_isolation on public.ai_lead_searches to crm_workspace_server
  using(workspace_id=(select crm_tenancy.workspace_id())) with check(workspace_id=(select crm_tenancy.workspace_id()));
create policy crm_workspace_isolation on public.ai_lead_feedback to crm_workspace_server
  using(workspace_id=(select crm_tenancy.workspace_id())) with check(workspace_id=(select crm_tenancy.workspace_id()));

-- Lock, duplicate check, company/contact/profile/event writes and result update
-- are one transaction. Clients supply only a stored search and candidate ID.
create function public.save_ai_lead(p_search_id uuid,p_lead_id text,p_actor_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.ai_lead_searches%rowtype; lead jsonb; position integer; company uuid; contact_email text; existing boolean:=false; email_conflict boolean:=false;
begin
  if not exists(select 1 from public.workspace_members where user_id=p_actor_id and activated_at is not null and role in ('admin','operator','bd_manager')) then raise insufficient_privilege; end if;
  select * into s from public.ai_lead_searches where id=p_search_id for update;
  if not found or s.status<>'complete' then raise exception 'Search is not complete'; end if;
  select value,(ordinality-1)::int into lead,position from jsonb_array_elements(s.results) with ordinality where value->>'id'=p_lead_id;
  if lead is null then raise exception 'Lead not found'; end if;
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
