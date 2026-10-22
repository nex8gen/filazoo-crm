begin;

alter table public.meta_leads
  add column if not exists company_id uuid references public.companies(id) on delete set null,
  add column if not exists contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists processed_at timestamptz;
create index if not exists meta_leads_company_id_idx on public.meta_leads(company_id);
create index if not exists meta_leads_contact_id_idx on public.meta_leads(contact_id);

-- All lead ingress paths (native Meta, Make, historical import) use this one
-- transaction. A retry cannot leave a company without its contact/pipeline.
create or replace function public.link_meta_lead_company() returns trigger
language plpgsql security invoker set search_path = public, extensions, pg_temp as $$
declare
  answers jsonb;
  lead_email text;
  lead_name text;
  company_name text;
  company_website text;
  company_domain text;
  company_country text;
  company_city text;
  company_key uuid;
  contact_key uuid;
  owner_key uuid;
  order_text text;
  order_quantity integer;
begin
  if new.company_id is not null then return new; end if;
  if coalesce(nullif(btrim(new.full_name), ''), nullif(btrim(new.email), ''), nullif(btrim(new.phone), '')) is null then return new; end if;

  select coalesce(jsonb_object_agg(lower(item->>'name'), item->'values'->>0), '{}'::jsonb)
    into answers from jsonb_array_elements(new.field_data) item where item->>'name' is not null;
  lead_email := nullif(lower(btrim(new.email)), '');
  lead_name := coalesce(nullif(btrim(new.full_name), ''), lead_email, new.phone, 'Meta lead');
  company_name := coalesce(nullif(answers->>'company_name',''), nullif(answers->>'company',''), nullif(answers->>'business_name',''));
  company_website := coalesce(nullif(answers->>'website',''), nullif(answers->>'company_website',''), nullif(answers->>'business_website',''));
  if company_website is not null and company_website !~* '^https?://' then company_website := 'https://' || company_website; end if;
  if company_website ~* '^https?://([a-z0-9-]+\.)+[a-z]{2,}([/:?#]|$)' then
    company_domain := lower(regexp_replace(split_part(regexp_replace(company_website, '^https?://', '', 'i'), '/', 1), '^www\.', '', 'i'));
    company_domain := split_part(split_part(split_part(company_domain, ':', 1), '?', 1), '#', 1);
  else company_website := null;
  end if;
  if company_domain is null and lead_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    company_domain := split_part(lead_email, '@', 2);
    if company_domain = any(array['gmail.com','googlemail.com','hotmail.com','outlook.com','live.com','icloud.com','me.com','yahoo.com','qq.com','163.com','126.com','proton.me','protonmail.com','aol.com']) then company_domain := null; end if;
  end if;
  company_name := coalesce(company_name, case when company_domain is not null then initcap(replace(split_part(company_domain, '.', 1), '-', ' ')) end, lead_name || ' (Meta lead)');
  company_country := nullif(answers->>'country','');
  company_city := nullif(answers->>'city','');
  order_text := coalesce(answers->>'what_is_your_expected_initial_order_quantity?', answers->>'expected_order_quantity', answers->>'order_quantity');
  if substring(order_text from '[0-9]+') is not null then
    order_quantity := least(substring(order_text from '[0-9]+')::numeric, 2147483647)::integer;
  end if;

  -- Serialize shared identities; generic mailbox providers never merge companies.
  perform pg_advisory_xact_lock(hashtextextended('meta-company:' || coalesce(company_domain, lead_email, new.leadgen_id), 0));
  if lead_email is not null then
    select id, company_id into contact_key, company_key from public.contacts where email = lead_email::extensions.citext;
  end if;
  if company_key is null and company_domain is not null then
    select id into company_key from public.companies where domain = company_domain::extensions.citext;
  end if;
  if company_key is null then
    insert into public.companies(name, website, domain, country, city, segment, source, source_url, status, discovered_at)
    values(left(company_name, 500), company_website, company_domain, company_country, company_city,
      'Meta B2B lead', 'meta_lead_ads', 'https://www.facebook.com/' || new.page_id, 'new', new.created_at)
    returning id into company_key;
  else
    update public.companies set
      source = case when coalesce(source, '') like '%meta_lead_ads%' then source else concat_ws('+', nullif(source,''), 'meta_lead_ads') end,
      website = coalesce(website, company_website),
      country = coalesce(nullif(country,'Unknown'), company_country),
      city = coalesce(city, company_city)
    where id = company_key;
  end if;

  select owner_id into owner_key from public.pipeline where company_id = company_key for update;
  if owner_key is null then
    owner_key := case when new.assignment_method = 'manual' then new.owner_id else public.claim_next_bd_sales_manager() end;
  end if;
  insert into public.pipeline(company_id, stage, owner_id, estimated_order_quantity)
  values(company_key, 'new', owner_key, order_quantity)
  on conflict(company_id) do update set
    owner_id = coalesce(pipeline.owner_id, excluded.owner_id),
    estimated_order_quantity = coalesce(pipeline.estimated_order_quantity, excluded.estimated_order_quantity);

  if contact_key is null and lead_email is not null then
    insert into public.contacts(company_id, name, email, verification_status, consent_source)
    values(company_key, lead_name, lead_email, 'unverified', 'meta_lead_ads') returning id into contact_key;
  end if;
  insert into public.events(company_id, type, data, created_at)
  values(company_key, 'meta_lead_received', jsonb_build_object(
    'summary', lead_name || ' submitted a Meta lead form.' || case when new.phone is not null then ' Phone: ' || new.phone || '.' else '' end
      || case when order_text is not null then ' Expected order: ' || order_text || '.' else '' end,
    'leadgen_id', new.leadgen_id, 'email', lead_email, 'phone', new.phone,
    'form_id', new.form_id, 'ad_id', new.ad_id, 'details', answers), new.created_at);
  new.company_id := company_key;
  new.contact_id := contact_key;
  new.owner_id := owner_key;
  new.assignment_method := case when new.assignment_method = 'manual' then 'manual' when owner_key is not null then 'automatic' else null end;
  new.processed_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function public.link_meta_lead_company() from public, anon, authenticated;
grant execute on function public.link_meta_lead_company() to service_role;
drop trigger if exists meta_leads_link_company on public.meta_leads;
create trigger meta_leads_link_company before insert or update of email, full_name, phone, field_data, company_id
on public.meta_leads for each row execute function public.link_meta_lead_company();

commit;
