begin;

create table public.invoice_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(label) between 1 and 200),
  currency text check (currency ~ '^[A-Z]{3}$'),
  details jsonb not null check (jsonb_typeof(details) = 'object'),
  active boolean not null default true,
  sort_order integer not null default 0
);
alter table public.invoice_bank_accounts enable row level security;
revoke all on public.invoice_bank_accounts from anon, authenticated;
grant all on public.invoice_bank_accounts to service_role;

insert into public.invoice_bank_accounts(label,currency,sort_order,details) values
('HSBC — Account 1',null,1,'{"beneficiaryName":"Xinrui Manufacturing Technology Limited","beneficiaryAddress":"RM 1904A, 19/F., Lucky Commercial Centre, No. 103 Des Voeux Road West, Hong Kong","accountNumber":"002148153055","bankName":"HSBC Bank (China) Company Limited, Shenzhen Branch","bankAddress":"China Resources Building, No. 5001, ShenNan Road East, LuoHu District, Shenzhen, China","swift":"HSBCCNSHSZN","bankCode":""}'::jsonb),
('CCB Asia — USD','USD',2,'{"beneficiaryName":"Xinrui Manufacturing Technology Limited","beneficiaryAddress":"RM 1904A, 19/F., Lucky Commercial Centre, No. 103 Des Voeux Road West, Hong Kong","accountNumber":"846210337118","bankName":"China Construction Bank (Asia) Corporation Limited","bankAddress":"20/F, CCB Centre, 18 Wang Chiu Road, Kowloon Bay, Kowloon, Hong Kong","swift":"CCBQHKAX","bankCode":"009"}'::jsonb),
('CCB Asia — HKD','HKD',3,'{"beneficiaryName":"Xinrui Manufacturing Technology Limited","beneficiaryAddress":"RM 1904A, 19/F., Lucky Commercial Centre, No. 103 Des Voeux Road West, Hong Kong","accountNumber":"846210337100","bankName":"China Construction Bank (Asia) Corporation Limited","bankAddress":"20/F, CCB Centre, 18 Wang Chiu Road, Kowloon Bay, Kowloon, Hong Kong","swift":"CCBQHKAX","bankCode":"009"}'::jsonb);

-- Resolve bank details on the server, rather than trusting a submitted snapshot.
create function public.invoice_bank_snapshot()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  account public.invoice_bank_accounts;
begin
  if nullif(new.document->>'bankAccountId', '') is null then
    new.document := new.document - 'bankAccount';
    return new;
  end if;
  select * into account from public.invoice_bank_accounts
  where id = (new.document->>'bankAccountId')::uuid and active;
  if not found then raise exception 'Select an active receiving bank account.'; end if;
  if account.currency is not null and account.currency <> new.document->>'currency' then
    raise exception 'Choose a bank account that matches the invoice currency.';
  end if;
  new.document := jsonb_set(new.document, '{bankAccount}', account.details ||
    jsonb_build_object('id', account.id, 'label', account.label, 'currency', account.currency));
  return new;
end;
$$;
revoke all on function public.invoice_bank_snapshot() from public, anon, authenticated;
grant execute on function public.invoice_bank_snapshot() to service_role;
create trigger invoices_bank_snapshot before insert or update of document on public.invoices
for each row execute function public.invoice_bank_snapshot();

commit;
