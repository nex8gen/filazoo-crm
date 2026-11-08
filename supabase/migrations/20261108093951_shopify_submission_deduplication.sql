begin;
set local lock_timeout = '5s';

-- Compare only customer-entered fields: CAPTCHA, form keys, submission IDs
-- and request geography change between deliveries of the same enquiry.
create function public.shopify_form_content(p_payload jsonb) returns jsonb
language sql immutable parallel safe security invoker set search_path = '' as $$
  select coalesce(jsonb_object_agg(key,
    case when key = 'contact[email]' then lower(btrim(value)) else btrim(value) end
  ), '{}'::jsonb)
  from jsonb_each_text(p_payload)
  where key like 'contact[%]' and btrim(value) <> '';
$$;
revoke all on function public.shopify_form_content(jsonb) from public, anon, authenticated;
grant execute on function public.shopify_form_content(jsonb) to service_role, crm_workspace_server;

alter table public.shopify_leads
  add column form_content jsonb generated always as (
    case when customer_id like 'form:%' then public.shopify_form_content(raw_payload) end
  ) stored,
  add column duplicate_of text;
alter table public.shopify_leads add constraint shopify_leads_duplicate_of_fkey
  foreign key (workspace_id, duplicate_of) references public.shopify_leads(workspace_id, webhook_id)
  on delete set null (duplicate_of);
create index shopify_leads_duplicate_of_idx on public.shopify_leads(workspace_id, duplicate_of)
  where duplicate_of is not null;
comment on column public.shopify_leads.duplicate_of is
  'Historical identical form repeat. Original payload and thread ID remain available for reply history.';

-- One atomic claim replaces the old SELECT followed by UPSERT. Advisory locks
-- protect requests with both the same ID and different IDs for one enquiry.
create function public.claim_shopify_lead(p_lead jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_workspace uuid := crm_tenancy.workspace_id();
  v_id text := p_lead->>'webhook_id';
  v_shop text := lower(btrim(p_lead->>'shop_domain'));
  v_email text := lower(btrim(p_lead->>'email'));
  v_content jsonb := public.shopify_form_content(p_lead->'raw_payload');
  v_existing public.shopify_leads%rowtype;
begin
  if v_id is null or v_shop is null or v_email is null then
    raise exception 'Shopify webhook ID, store and email are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':shopify-id:' || v_id, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':shopify-email:' || v_shop || ':' || v_email, 0));

  select * into v_existing from public.shopify_leads
    where workspace_id = v_workspace and webhook_id = v_id for update;
  if found and v_existing.status = 'processed' then
    return jsonb_build_object('claimed', false, 'status', v_existing.status,
      'company_id', v_existing.company_id, 'contact_id', v_existing.contact_id);
  end if;
  if found and v_existing.status = 'processing' and v_existing.updated_at > now() - interval '15 minutes' then
    return jsonb_build_object('claimed', false, 'status', 'processing');
  end if;

  -- Ten minutes covers double-clicks and CAPTCHA resubmissions, while later or
  -- changed enquiries are retained. Customer-create webhook redeliveries use
  -- the stable Shopify customer ID instead of form content.
  select * into v_existing from public.shopify_leads
    where workspace_id = v_workspace and shop_domain = v_shop
      and duplicate_of is null and webhook_id <> v_id
      and status in ('processed', 'processing')
      and (
        (p_lead->>'customer_id' like 'form:%' and customer_id like 'form:%'
          and email::text = v_email and form_content = v_content
          and created_at >= now() - interval '10 minutes')
        or (p_lead->>'customer_id' not like 'form:%' and customer_id = p_lead->>'customer_id')
      )
      and (status = 'processed' or updated_at > now() - interval '15 minutes')
    order by created_at, webhook_id limit 1 for update;
  if found then
    return jsonb_build_object('claimed', false, 'status', v_existing.status,
      'company_id', v_existing.company_id, 'contact_id', v_existing.contact_id);
  end if;

  insert into public.shopify_leads as target
    (workspace_id, webhook_id, shop_domain, customer_id, email, company_name,
     full_name, phone, tags, status, raw_payload, created_at)
  values (v_workspace, v_id, v_shop, p_lead->>'customer_id', v_email,
    p_lead->>'company_name', p_lead->>'full_name', p_lead->>'phone',
    array(select jsonb_array_elements_text(p_lead->'tags')), 'processing',
    p_lead->'raw_payload', (p_lead->>'created_at')::timestamptz)
  on conflict (workspace_id, webhook_id) do update
    set status = 'processing', error_message = null;
  return jsonb_build_object('claimed', true, 'status', 'processing');
end;
$$;
revoke all on function public.claim_shopify_lead(jsonb) from public, anon, authenticated;
grant execute on function public.claim_shopify_lead(jsonb) to service_role, crm_workspace_server;
commit;
