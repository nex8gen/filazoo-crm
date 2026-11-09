-- Disposable workspaces and assets are rolled back after verifying isolation.
begin;
do $$
declare owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid(); tenant_a uuid; tenant_b uuid; asset_id uuid; changed integer;
begin
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    (owner_a,owner_a||'@marketing-test.invalid',now(),'{}'),
    (owner_b,owner_b||'@marketing-test.invalid',now(),'{}');
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform set_config('role','service_role',true);
  tenant_a:=public.create_crm_workspace(owner_a,'Marketing test A','marketing-test-a-'||owner_a);
  insert into public.marketing_assets(category,slot,year,title,start_date,end_date,created_by,updated_by)
    values('month_end','month-1',2026,'January offer','2026-01-25','2026-01-31',owner_a,owner_a) returning id into asset_id;
  if (select title from public.marketing_assets where id=asset_id)<>'January offer' then raise exception 'Saved plan was not readable'; end if;
  update public.marketing_assets set offer='Bulk pricing',message='Request a quote',status='ready',updated_at=now()+interval '1 second' where id=asset_id;
  update public.marketing_assets set title='Stale overwrite' where id=asset_id and updated_at=now();
  get diagnostics changed=row_count;
  if changed<>0 then raise exception 'Stale update was accepted'; end if;
  begin
    insert into public.marketing_assets(category,slot,year,title,start_date,end_date,created_by,updated_by)
      values('month_end','month-1',2026,'Duplicate','2026-01-25','2026-01-31',owner_a,owner_a);
    raise exception 'Duplicate slot was accepted';
  exception when unique_violation then null; end;
  begin
    update public.marketing_assets set end_date='2026-01-01' where id=asset_id;
    raise exception 'Reversed dates were accepted';
  exception when check_violation then null; end;
  perform set_config('role','service_role',true);
  tenant_b:=public.create_crm_workspace(owner_b,'Marketing test B','marketing-test-b-'||owner_b);
  if exists(select 1 from public.marketing_assets where id=asset_id) then raise exception 'Marketing plan leaked between workspaces'; end if;
  update public.marketing_assets set title='Cross-workspace update' where id=asset_id;
  get diagnostics changed=row_count;
  if changed<>0 then raise exception 'Cross-workspace update was accepted'; end if;
  delete from public.marketing_assets where id=asset_id;
  get diagnostics changed=row_count;
  if changed<>0 then raise exception 'Cross-workspace delete was accepted'; end if;
  perform set_config('role','postgres',true);
  if has_table_privilege('anon','public.marketing_assets','select') or has_table_privilege('authenticated','public.marketing_assets','select') then raise exception 'Marketing plans exposed to direct client access'; end if;
end $$;
rollback;
