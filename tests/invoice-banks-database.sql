begin;
set local role service_role;
do $$
declare
  usd public.invoice_bank_accounts;
  hkd public.invoice_bank_accounts;
  actor uuid;
  inv public.invoices;
  saved public.invoices;
begin
  select * into usd from public.invoice_bank_accounts where currency='USD' and active limit 1;
  select * into hkd from public.invoice_bank_accounts where currency='HKD' and active limit 1;
  select user_id into actor from public.workspace_members where role in ('admin','operator') and activated_at is not null limit 1;
  if usd.id is null or hkd.id is null or actor is null then raise exception 'Bank tests require seeded accounts and a billing user.'; end if;
  insert into public.invoices(number,document,total_minor,created_by) overriding system value
  values(-910041,jsonb_build_object('customerName','BANK ROLLBACK TEST','currency','USD','bankAccountId',usd.id,'bankAccount',jsonb_build_object('accountNumber','FORGED')),1000,actor) returning * into inv;
  if inv.document#>>'{bankAccount,accountNumber}' is distinct from usd.details->>'accountNumber' then raise exception 'TEST FAILED: client snapshot was trusted'; end if;
  update public.invoice_bank_accounts set details=jsonb_set(details,'{accountNumber}','"TEST UPDATED"') where id=usd.id;
  select * into saved from public.invoices where id=inv.id;
  if saved.document#>>'{bankAccount,accountNumber}' is distinct from usd.details->>'accountNumber' then raise exception 'TEST FAILED: bank edits changed saved invoice'; end if;
  perform public.mutate_invoice(inv.id,actor,jsonb_build_object('action','issue','revision',1));
  select * into saved from public.invoices where id=inv.id;
  if saved.document#>>'{bankAccount,accountNumber}' is distinct from usd.details->>'accountNumber' then raise exception 'TEST FAILED: issuing refreshed saved bank details'; end if;
  begin
    insert into public.invoices(number,document,total_minor,created_by) overriding system value
    values(-910042,jsonb_build_object('currency','USD','bankAccountId',hkd.id),1000,actor);
    raise exception 'TEST FAILED: currency mismatch accepted';
  exception when raise_exception then
    if sqlerrm <> 'Choose a bank account that matches the invoice currency.' then raise; end if;
  end;
  update public.invoice_bank_accounts set active=false where id=hkd.id;
  begin
    insert into public.invoices(number,document,total_minor,created_by) overriding system value
    values(-910043,jsonb_build_object('currency','HKD','bankAccountId',hkd.id),1000,actor);
    raise exception 'TEST FAILED: inactive bank accepted';
  exception when raise_exception then
    if sqlerrm <> 'Select an active receiving bank account.' then raise; end if;
  end;
  insert into public.invoices(number,document,total_minor,created_by) overriding system value
  values(-910044,jsonb_build_object('currency','USD','bankAccount',jsonb_build_object('accountNumber','FORGED')),1000,actor) returning * into saved;
  if saved.document ? 'bankAccount' then raise exception 'TEST FAILED: unselected bank snapshot accepted'; end if;
  if has_table_privilege('anon','public.invoice_bank_accounts','SELECT') or has_table_privilege('authenticated','public.invoice_bank_accounts','SELECT') then raise exception 'TEST FAILED: bank accounts exposed directly'; end if;
end;
$$;
rollback;
