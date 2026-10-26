begin;
create function public.connect_portal_invoice_customer(p_invoice_id uuid, p_actor_id uuid, p_company_id uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare inv public.invoices; target uuid; contact uuid; billing_email text; matches integer; owner uuid;
begin
  if p_actor_id is null or not exists(select 1 from public.workspace_members where user_id=p_actor_id and activated_at is not null and role in ('admin','operator','bd_manager')) then
    raise exception 'Active workspace access is required.';
  end if;
  select * into inv from public.invoices where id=p_invoice_id for update;
  if not found or inv.status='draft' then raise exception 'Choose an issued customer invoice.'; end if;
  if inv.company_id is not null then
    if p_company_id is not null and p_company_id<>inv.company_id then raise exception 'This invoice is already connected to another customer.'; end if;
    return inv.company_id;
  end if;
  billing_email := lower(btrim(inv.document->>'customerEmail'));
  if coalesce(billing_email,'')='' then raise exception 'The invoice needs a customer billing email.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('portal-customer:' || billing_email,0));
  if p_company_id is not null then
    select id into target from public.companies where id=p_company_id for share;
    if target is null then raise exception 'Customer profile not found.'; end if;
  else
    select count(distinct company_id), (array_agg(distinct company_id))[1] into matches,target from public.contacts where lower(btrim(contacts.email::text))=billing_email;
    if matches>1 then raise exception 'Several customers use this email. Choose the correct customer profile.'; end if;
    if matches=0 then
      select count(*),(array_agg(id))[1] into matches,target from public.companies where lower(btrim(name))=lower(btrim(inv.document->>'customerName'));
      if matches>1 then raise exception 'Several customer profiles have this name. Choose the correct profile.'; end if;
    end if;
    if target is null then
      insert into public.companies(name,source,status) values(inv.document->>'customerName','manual','customer') returning id into target;
      select user_id into owner from public.workspace_members where user_id=inv.created_by and role='bd_manager' and activated_at is not null;
      insert into public.pipeline(company_id,owner_id) values(target,owner);
    end if;
  end if;
  select id into contact from public.contacts where company_id=target and lower(btrim(contacts.email::text))=billing_email order by created_at,id limit 1;
  if contact is null then
    insert into public.contacts(company_id,email,role,verification_status) values(target,billing_email,'Billing contact','unverified') returning id into contact;
  end if;
  insert into public.customer_billing_profiles(company_id,profile,updated_by)
    values(target,jsonb_build_object('email',billing_email,'address',coalesce(inv.document->>'customerAddress',''),'taxId',coalesce(inv.document->>'customerTaxId',''),'currency',inv.document->>'currency','termsDays',0),p_actor_id)
    on conflict(company_id) do nothing;
  -- Financial document and its signature stay unchanged; update live CRM links.
  update public.invoices set company_id=target,contact_id=contact,revision=revision+1,updated_at=now() where id=inv.id;
  insert into public.events(company_id,actor_id,type,data) values(target,p_actor_id,'invoice_customer_connected',jsonb_build_object('invoiceId',inv.id,'summary','INV-' || lpad(inv.number::text,6,'0') || ' and its portal conversation were connected to this customer.'));
  return target;
end;
$$;
revoke all on function public.connect_portal_invoice_customer(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.connect_portal_invoice_customer(uuid,uuid,uuid) to service_role;

-- Existing records are connected only when a staff member chooses the profile
-- connection action. Installing this workflow does not backfill customer data.
commit;
