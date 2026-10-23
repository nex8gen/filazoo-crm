begin;
set local role service_role;
do $$
declare actor uuid; company uuid:=gen_random_uuid(); other_company uuid:=gen_random_uuid(); contact uuid:=gen_random_uuid(); inv public.invoices; summary jsonb;
begin
  select user_id into actor from public.workspace_members where activated_at is not null and role in('admin','operator') limit 1;
  if actor is null then raise exception 'Test requires active billing member'; end if;
  insert into public.companies(id,name) values(company,'ROLLBACK invoice connection test'),(other_company,'ROLLBACK other customer');
  insert into public.contacts(id,company_id,email) values(contact,company,'invoice-connection-rollback@example.invalid');
  insert into public.customer_billing_profiles(company_id,profile,updated_by) values(company,'{"address":"test","taxId":"test","email":"","currency":"USD","termsDays":30}',actor);
  insert into public.invoices(number,document,total_minor,created_by) overriding system value values(-1001,jsonb_build_object('companyId',company,'contactId',contact,'sourceThreadId','rollback-thread','customerName','ROLLBACK invoice connection test','currency','USD','dueDate','2020-01-01'),1000,actor) returning * into inv;
  if inv.company_id<>company or inv.contact_id<>contact or inv.source_thread_id<>'rollback-thread' then raise exception 'TEST FAILED: invoice links not persisted'; end if;
  begin
    insert into public.invoices(number,document,total_minor,created_by) overriding system value values(-1002,jsonb_build_object('companyId',other_company,'contactId',contact),1000,actor);
    raise exception 'TEST FAILED: cross-company contact accepted';
  exception when raise_exception then if sqlerrm<>'The selected contact does not belong to this customer.' then raise; end if; end;
  perform public.mutate_invoice(inv.id,actor,'{"action":"issue","revision":1}');
  if not exists(select 1 from public.events where company_id=company and type='invoice_issue' and data->>'invoiceId'=inv.id::text) then raise exception 'TEST FAILED: missing customer timeline event'; end if;
  summary:=public.invoice_receivables(company,'','');
  if (summary->0->>'outstanding_minor')::bigint<>1000 or (summary->0->>'overdue_minor')::bigint<>1000 then raise exception 'TEST FAILED: customer receivables summary'; end if;
  perform public.mutate_invoice(inv.id,actor,jsonb_build_object('action','payment','payment',jsonb_build_object('id',gen_random_uuid(),'amountMinor',400,'paidOn',current_date,'method','bank_transfer','reference','rollback')));
  summary:=public.invoice_receivables(company,'','');
  if (summary->0->>'outstanding_minor')::bigint<>600 or (summary->0->>'paid_minor')::bigint<>400 then raise exception 'TEST FAILED: summary after payment'; end if;
  if not exists(select 1 from public.events where company_id=company and type='invoice_payment') then raise exception 'TEST FAILED: payment timeline'; end if;
end; $$;
set local role authenticated;
do $$ begin
  begin perform 1 from public.customer_billing_profiles;raise exception 'TEST FAILED: direct customer billing read allowed';exception when insufficient_privilege then null;end;
  begin perform 1 from public.invoice_settings;raise exception 'TEST FAILED: direct seller settings read allowed';exception when insufficient_privilege then null;end;
  begin perform public.invoice_receivables(null,'','');raise exception 'TEST FAILED: direct receivables read allowed';exception when insufficient_privilege then null;end;
end; $$;
rollback;
