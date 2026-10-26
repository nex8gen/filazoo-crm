-- Rollback-only integration checks. No customer data or messages are retained.
begin;
set local role service_role;
do $$
declare inv uuid; test_email text := 'portal-rollback@example.test'; first_claim integer; second_claim integer; i integer;
begin
  select id into inv from public.invoices limit 1;
  if inv is null then raise exception 'Test requires an invoice.'; end if;
  insert into public.customer_portal_accounts(email) values(test_email);
  insert into public.customer_portal_sessions(token_hash,invoice_id,email,kind,credential_version,expires_at)
    values(repeat('a',64),inv,test_email,'qr',0,now()+interval '1 hour');
  update public.customer_portal_accounts set password_hash='scrypt-test',credential_version=1
    where customer_portal_accounts.email=test_email and password_hash is null;
  get diagnostics first_claim = row_count;
  update public.customer_portal_accounts set password_hash='overwrite',credential_version=2
    where customer_portal_accounts.email=test_email and password_hash is null;
  get diagnostics second_claim = row_count;
  if first_claim <> 1 or second_claim <> 0 then raise exception 'Password claim is not exclusive'; end if;
  if exists(select 1 from public.customer_portal_sessions s join public.customer_portal_accounts a using(email) where s.token_hash=repeat('a',64) and s.credential_version=a.credential_version) then raise exception 'Old QR credential remained valid'; end if;
  insert into public.customer_portal_messages(invoice_id,sender,body) values(inv,'customer','ROLLBACK PORTAL TEST');
  insert into public.customer_portal_shipments(invoice_id,status,location) values(inv,'in_transit','Test location')
    on conflict(invoice_id) do update set status=excluded.status;
  for i in 1..3 loop
    if not public.customer_portal_rate_limit(repeat('b',64),3) then raise exception 'Throttled too early'; end if;
  end loop;
  if public.customer_portal_rate_limit(repeat('b',64),3) then raise exception 'Rate limit did not hold'; end if;
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.customer_portal_accounts;
    raise exception 'Anonymous credential access accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.customer_portal_rate_limit(repeat('c',64),3);
    raise exception 'Anonymous privileged RPC accepted';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
set local role authenticated;
do $$
begin
  begin
    perform 1 from public.customer_portal_messages;
    raise exception 'Direct authenticated customer data access accepted';
  exception when insufficient_privilege then null; end;
end;
$$;
rollback;
