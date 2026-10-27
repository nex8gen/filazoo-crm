begin;

-- The authenticated server validates a strict field patch. Only supplied columns
-- change; unknown/legacy values in unrelated fields never block the operation.
create function public.patch_company_profile_fields(p_company_id uuid, p_actor_id uuid, p_changes jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  company public.companies%rowtype;
  previous_pipeline public.pipeline%rowtype;
  primary_contact uuid;
  contact_created boolean := false;
begin
  if not exists(select 1 from public.workspace_members where user_id = p_actor_id and activated_at is not null and role in ('admin','operator','bd_manager')) then
    raise exception 'Your workspace role cannot edit customer profiles.';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'Specify the customer fields to update.';
  end if;
  if exists(select 1 from jsonb_object_keys(p_changes) as field where field <> all(array[
    'name','website','country','city','segment','contactName','contactRole','contactEmail','stage',
    'summary','tags','fitScore','estimatedOrderQuantity','estimatedValue','currency','nextFollowupAt','commerce'
  ])) then raise exception 'Unsupported customer profile field.'; end if;
  if p_changes ? 'commerce' then
    if jsonb_typeof(p_changes->'commerce') <> 'object' then raise exception 'Invalid billing or shipping details.'; end if;
    if exists(select 1 from jsonb_object_keys(p_changes->'commerce') as field where field <> all(array[
      'phone','shippingRecipient','shippingPhone','shippingAddress','shippingNotes','address','taxId','email','currency','termsDays'
    ])) then raise exception 'Unsupported billing or shipping field.'; end if;
  end if;
  select * into company from public.companies where id = p_company_id for update;
  if not found then raise exception 'The company no longer exists.'; end if;
  select * into previous_pipeline from public.pipeline where company_id = p_company_id;
  select id into primary_contact from public.contacts where company_id = p_company_id order by created_at,id limit 1 for update;

  if p_changes ?| array['contactName','contactRole','contactEmail'] then
    if primary_contact is null then
      if coalesce(p_changes->>'contactEmail','') = '' then raise exception 'Add a contact email before saving a new contact name or role.'; end if;
      insert into public.contacts(company_id,name,role,email,verification_status)
        values(p_company_id,nullif(p_changes->>'contactName',''),nullif(p_changes->>'contactRole',''),p_changes->>'contactEmail','unverified') returning id into primary_contact;
      contact_created := true;
    else
      update public.contacts set
        name = case when p_changes ? 'contactName' then nullif(p_changes->>'contactName','') else name end,
        role = case when p_changes ? 'contactRole' then nullif(p_changes->>'contactRole','') else role end,
        email = case when p_changes ? 'contactEmail' then p_changes->>'contactEmail' else email end,
        updated_at = now()
      where id = primary_contact;
    end if;
  end if;
  if p_changes ?| array['name','website','country','city','segment','stage'] then
    update public.companies set
      name = case when p_changes ? 'name' then p_changes->>'name' else name end,
      website = case when p_changes ? 'website' then nullif(p_changes->>'website','') else website end,
      domain = case when p_changes ? 'website' then nullif(lower(regexp_replace(regexp_replace(regexp_replace(split_part(split_part(p_changes->>'website','://',2),'/',1),'^.*@',''),':[0-9]+$',''),'^www\.','')),'') else domain end,
      country = case when p_changes ? 'country' then p_changes->>'country' else country end,
      city = case when p_changes ? 'city' then nullif(p_changes->>'city','') else city end,
      segment = case when p_changes ? 'segment' then p_changes->>'segment' else segment end,
      status = case when p_changes ? 'stage' then case p_changes->>'stage' when 'new' then 'new' when 'won' then 'customer' when 'lost' then 'disqualified' else 'engaged' end else status end,
      updated_at = now()
    where id = p_company_id;
  end if;
  if p_changes ?| array['stage','estimatedOrderQuantity','estimatedValue','currency','nextFollowupAt'] then
    insert into public.pipeline(company_id) values(p_company_id) on conflict(company_id) do nothing;
    update public.pipeline set
      stage = case when p_changes ? 'stage' then p_changes->>'stage' else stage end,
      estimated_order_quantity = case when p_changes ? 'estimatedOrderQuantity' then nullif(p_changes->>'estimatedOrderQuantity','')::integer else estimated_order_quantity end,
      estimated_value = case when p_changes ? 'estimatedValue' then nullif(p_changes->>'estimatedValue','')::numeric else estimated_value end,
      currency = case when p_changes ? 'currency' then p_changes->>'currency' else currency end,
      next_followup_at = case when p_changes ? 'nextFollowupAt' then nullif(p_changes->>'nextFollowupAt','')::timestamptz else next_followup_at end,
      updated_at = now()
    where company_id = p_company_id;
  end if;
  if p_changes ?| array['summary','fitScore','tags'] then
    insert into public.company_profiles(company_id) values(p_company_id) on conflict(company_id) do nothing;
    update public.company_profiles set
      summary = case when p_changes ? 'summary' then nullif(p_changes->>'summary','') else summary end,
      fit_score = case when p_changes ? 'fitScore' then nullif(p_changes->>'fitScore','')::integer else fit_score end,
      interest_tags = case when p_changes ? 'tags' then array(select btrim(tag) from unnest(string_to_array(p_changes->>'tags',',')) as tag where btrim(tag) <> '' limit 50) else interest_tags end,
      updated_at = now()
    where company_id = p_company_id;
  end if;
  if p_changes ? 'commerce' then
    insert into public.customer_billing_profiles(company_id,profile,updated_by,updated_at)
      values(p_company_id,p_changes->'commerce',p_actor_id,now())
    on conflict(company_id) do update set profile = public.customer_billing_profiles.profile || excluded.profile, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  insert into public.events(company_id,actor_id,type,data) values(p_company_id,p_actor_id,'company_updated',
    jsonb_build_object('summary',coalesce(p_changes->>'name',company.name) || ' details were updated.','fields',array(select jsonb_object_keys(p_changes))));
  return jsonb_build_object('companyName',coalesce(p_changes->>'name',company.name),'contactId',primary_contact,'contactCreated',contact_created,
    'segmentChanged',p_changes ? 'segment' and company.segment is distinct from p_changes->>'segment',
    'stageChanged',p_changes ? 'stage' and coalesce(previous_pipeline.stage,'new') is distinct from p_changes->>'stage');
end;
$$;
revoke all on function public.patch_company_profile_fields(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.patch_company_profile_fields(uuid,uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
