begin;
set local role service_role;
do $$
declare actor uuid; inv public.invoices; inv2 public.invoices; company uuid; other_company uuid; saved_document jsonb; amount bigint;
begin
  select user_id into actor from public.workspace_members where role in ('admin','operator') and activated_at is not null limit 1;
  if actor is null then raise exception 'An active billing member is required.'; end if;
  insert into public.invoices(number,document,status,total_minor,created_by) overriding system value
    values(-99101,'{"customerName":"ROLLBACK PORTAL CUSTOMER","customerEmail":"portal-profile-test@example.test","currency":"USD","dueDate":"2026-10-26","items":[]}', 'issued',1200,actor) returning * into inv;
  saved_document := inv.document;
  insert into public.customer_portal_messages(invoice_id,sender,body) values(inv.id,'customer','Preserve this conversation');
  insert into public.customer_portal_shipments(invoice_id,status,location) values(inv.id,'in_transit','Preserve tracking');
  company := public.connect_portal_invoice_customer(inv.id,actor,null);
  if company is null or public.connect_portal_invoice_customer(inv.id,actor,null)<>company then raise exception 'Profile connection is not idempotent'; end if;
  select * into inv from public.invoices where id=inv.id;
  if inv.document<>saved_document or inv.total_minor<>1200 or inv.paid_minor<>0 then raise exception 'Invoice financial snapshot changed'; end if;
  if not exists(select 1 from public.customer_portal_messages where invoice_id=inv.id and body='Preserve this conversation') then raise exception 'Conversation was lost'; end if;
  if not exists(select 1 from public.customer_portal_shipments where invoice_id=inv.id and location='Preserve tracking') then raise exception 'Tracking was lost'; end if;
  insert into public.invoices(number,document,status,total_minor,created_by) overriding system value values(-99102,saved_document,'issued',1200,actor) returning * into inv2;
  if public.connect_portal_invoice_customer(inv2.id,actor,null)<>company then raise exception 'The same billing customer was duplicated'; end if;
  if (select count(*) from public.contacts where company_id=company and email='portal-profile-test@example.test')<>1 then raise exception 'Duplicate billing contacts'; end if;
  insert into public.companies(name) values('ROLLBACK OTHER CUSTOMER') returning id into other_company;
  begin
    perform public.connect_portal_invoice_customer(inv.id,actor,other_company);
    raise exception 'TEST FAILED: a connected invoice was reassigned';
  exception when raise_exception then if sqlerrm not like 'This invoice is already connected%' then raise; end if; end;
  begin
    perform public.connect_portal_invoice_customer(inv.id,null,null);
    raise exception 'TEST FAILED: null staff actor accepted';
  exception when raise_exception then if sqlerrm<>'Active workspace access is required.' then raise; end if; end;
  begin
    perform public.connect_portal_invoice_customer(inv.id,gen_random_uuid(),null);
    raise exception 'TEST FAILED: non-member actor accepted';
  exception when raise_exception then if sqlerrm<>'Active workspace access is required.' then raise; end if; end;
end; $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform public.connect_portal_invoice_customer(gen_random_uuid(),gen_random_uuid(),null);
    raise exception 'TEST FAILED: anonymous function access';
  exception when insufficient_privilege then null; end;
end; $$;
rollback;
