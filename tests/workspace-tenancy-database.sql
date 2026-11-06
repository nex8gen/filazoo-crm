-- Run after the tenancy migration in ONE transaction; always roll it back.
-- Synthetic users never receive mail and no existing customer records are changed.
do $$
declare
  owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid(); colleague uuid:=gen_random_uuid();
  tenant_a uuid; tenant_b uuid; company_a uuid:=gen_random_uuid(); company_b uuid:=gen_random_uuid();
  invite_hash text:=encode(extensions.gen_random_bytes(32),'hex'); result uuid; n integer;
begin
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    (owner_a,owner_a||'@workspace-test.invalid',now(),'{"display_name":"Owner A"}'),
    (owner_b,owner_b||'@workspace-test.invalid',now(),'{"display_name":"Owner B"}'),
    (colleague,colleague||'@workspace-test.invalid',now(),'{"display_name":"Colleague"}');
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform set_config('role','service_role',true);
  tenant_a:=public.create_crm_workspace(owner_a,'Workspace A','test-a-'||owner_a);
  insert into public.companies(id,name,domain) values(company_a,'A Company','same-domain.invalid');
  insert into public.products(sku,name) values('SAME-SKU','Product A');
  perform set_config('role','service_role',true);
  tenant_b:=public.create_crm_workspace(owner_b,'Workspace B','test-b-'||owner_b);
  insert into public.companies(id,name,domain) values(company_b,'B Company','same-domain.invalid');
  insert into public.products(sku,name) values('SAME-SKU','Product B');
  select count(*) into n from public.companies;
  if n<>1 or not exists(select 1 from public.companies where id=company_b) then raise exception 'Tenant SELECT isolation failed'; end if;
  update public.companies set name='Cross-tenant update' where id=company_a;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Tenant UPDATE isolation failed'; end if;
  delete from public.companies where id=company_a;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Tenant DELETE isolation failed'; end if;
  begin
    insert into public.contacts(company_id,email) values(company_a,'cross-tenant@example.invalid');
    raise exception 'Cross-tenant FK was accepted';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.companies(workspace_id,name) values(tenant_a,'Forged tenant');
    raise exception 'Forged INSERT was accepted';
  exception when insufficient_privilege then null; end;
  -- RPCs inherit the same RLS boundary, including joins and nested inserts.
  if public.claim_next_bd_sales_manager() is not null then raise exception 'Cross-tenant assignment pool leaked'; end if;
  if public.read_erp_connection() is not null then raise exception 'Legacy ERP credentials leaked'; end if;
  begin
    update public.workspace_members set role='viewer' where user_id=owner_b;
    raise exception 'Owner demotion was accepted';
  exception when raise_exception then
    if sqlerrm='Owner demotion was accepted' then raise; end if;
  end;
  perform set_config('role','service_role',true);
  insert into public.workspace_invitations(workspace_id,email,display_name,role,token_hash,invited_by)
    values(tenant_a,colleague||'@workspace-test.invalid','Colleague','viewer',invite_hash,owner_a);
  begin
    perform public.accept_workspace_invitation(owner_b,invite_hash);
    raise exception 'Invitation accepted by wrong email';
  exception when raise_exception then
    if sqlerrm='Invitation accepted by wrong email' then raise; end if;
  end;
  result:=public.accept_workspace_invitation(colleague,invite_hash);
  if result<>tenant_a or not exists(select 1 from public.workspace_members where user_id=colleague and role='viewer') then raise exception 'Invitation acceptance failed'; end if;
  perform set_config('role','service_role',true);
  begin
    perform public.accept_workspace_invitation(colleague,invite_hash);
    raise exception 'Invitation replay accepted';
  exception when raise_exception then
    if sqlerrm='Invitation replay accepted' then raise; end if;
  end;
  -- The same account joins another workspace without losing its first membership.
  invite_hash:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.workspace_invitations(workspace_id,email,display_name,role,token_hash,invited_by)
    values(tenant_b,colleague||'@workspace-test.invalid','Colleague','operator',invite_hash,owner_b);
  perform public.accept_workspace_invitation(colleague,invite_hash);
  perform set_config('role','service_role',true);
  perform public.leave_crm_workspace(tenant_b,colleague);
  perform set_config('role','service_role',true);
  if exists(select 1 from public.workspace_members where workspace_id=tenant_b and user_id=colleague)
    or not exists(select 1 from public.workspace_members where workspace_id=tenant_a and user_id=colleague) then raise exception 'Leaving affected the wrong workspace'; end if;
  perform public.transfer_crm_workspace(tenant_a,owner_a,colleague);
  if not exists(select 1 from public.workspace_members where user_id=colleague and role='admin') then raise exception 'Ownership transfer failed'; end if;
  perform set_config('role','service_role',true);
  -- Forged workspace selection is rejected at the pre-request boundary.
  perform set_config('request.headers',jsonb_build_object('x-crm-workspace-id',tenant_b,'x-crm-user-id',owner_a)::text,true);
  begin
    perform crm_tenancy.pre_request();
    raise exception 'Forged selection accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.headers',jsonb_build_object('x-crm-workspace-id',tenant_a,'x-crm-user-id',owner_a)::text,true);
  perform crm_tenancy.pre_request();
  if current_user<>'crm_workspace_server' then raise exception 'Service role was not downgraded'; end if;
  if exists(select 1 from public.companies where id=company_b) then raise exception 'Pre-request tenant isolation failed'; end if;
  -- Tenant calls enter the private job bodies, without scanning or dispatching
  -- work for other workspaces. These fixtures have no due tasks or ERP connection.
  if public.notify_due_crm_tasks()<>0 then raise exception 'Empty-workspace reminder isolation failed'; end if;
  if public.dispatch_erp_inventory_sync() is not null then raise exception 'Empty-workspace ERP isolation failed'; end if;
  perform set_config('role','postgres',true);
  if not exists(select 1 from auth.users where id=colleague) then raise exception 'Global account was deleted'; end if;
end $$;
