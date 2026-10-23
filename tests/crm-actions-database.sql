-- Run against the CRM database. All test records are rolled back.
begin;
do $$
declare
  company uuid;
  flow uuid;
  actor uuid;
begin
  select user_id into strict actor from public.workspace_members where role = 'admin' limit 1;
  insert into public.companies(name) values ('CRM action regression - rollback only') returning id into company;
  insert into public.contacts(company_id, email) values (company, 'crm-regression@example.invalid');
  insert into public.pipeline(company_id) values (company);
  insert into public.catalogs(company_id) values (company);
  delete from public.companies where id = company;
  if exists (select 1 from public.contacts where company_id = company)
    or exists (select 1 from public.pipeline where company_id = company)
    or exists (select 1 from public.catalogs where company_id = company) then
    raise exception 'Company deletion did not remove dependent records';
  end if;
  insert into public.flows(user_id, created_by, name, trigger_type)
    values (actor, actor, 'CRM action regression - rollback only', 'email_received') returning id into flow;
  insert into public.flow_steps(flow_id, position, type) values (flow, 0, 'stop');
  delete from public.flows where id = flow and user_id = actor;
  if exists (select 1 from public.flows where id = flow)
    or exists (select 1 from public.flow_steps where flow_id = flow) then
    raise exception 'Flow deletion did not remove the flow and steps';
  end if;
end $$;
rollback;
