create policy alipay_login_server_access on public.alipay_login_grants
  for all to service_role using (true) with check (true);
