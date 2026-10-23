-- Tests only use rollback fixtures and explicit numbers, without issuing real invoices.
begin;
set local role service_role;
do $$
declare
  manager uuid;
  admin_id uuid;
  own public.invoices;
  other public.invoices;
  result jsonb;
  operation text;
begin
  select user_id into manager from public.workspace_members where role = 'bd_manager' and activated_at is not null limit 1;
  select user_id into admin_id from public.workspace_members where role in ('admin','operator') and activated_at is not null limit 1;
  if manager is null or admin_id is null then raise exception 'Test requires active manager and billing members.'; end if;
  insert into public.invoices(number,document,total_minor,created_by) overriding system value
    values(-80001,'{"customerName":"MANAGER ROLLBACK TEST","currency":"USD"}',1000,manager) returning * into own;
  insert into public.invoices(number,document,total_minor,created_by) overriding system value
    values(-80002,'{"customerName":"OTHER ROLLBACK TEST","currency":"USD"}',1000,admin_id) returning * into other;
  result := public.mutate_invoice(own.id,manager,jsonb_build_object('action','save','revision',1,'document',own.document,'totalMinor',1200));
  if (result->>'revision')::integer <> 2 or (result->>'total_minor')::bigint <> 1200 then raise exception 'TEST FAILED: own draft not saved'; end if;
  begin
    perform public.mutate_invoice(other.id,manager,jsonb_build_object('action','save','revision',1,'document',other.document,'totalMinor',1200));
    raise exception 'TEST FAILED: manager edited another creator invoice';
  exception when raise_exception then
    if sqlerrm <> 'BD managers can only edit draft invoices they created.' then raise; end if;
  end;
  foreach operation in array array['issue','void','delete','payment'] loop
    begin
      perform public.mutate_invoice(own.id,manager,jsonb_build_object('action',operation,'revision',2));
      raise exception 'TEST FAILED: manager performed billing transition';
    exception when raise_exception then
      if sqlerrm <> 'BD managers can only edit draft invoices they created.' then raise; end if;
    end;
  end loop;
  update public.invoices set status='issued' where id=own.id;
  begin
    perform public.mutate_invoice(own.id,manager,jsonb_build_object('action','save','revision',2,'document',own.document,'totalMinor',1200));
    raise exception 'TEST FAILED: manager edited issued invoice';
  exception when raise_exception then
    if sqlerrm <> 'BD managers can only edit draft invoices they created.' then raise; end if;
  end;
  result := public.mutate_invoice(other.id,admin_id,jsonb_build_object('action','save','revision',1,'document',other.document,'totalMinor',1300));
  if (result->>'revision')::integer <> 2 then raise exception 'TEST FAILED: admin billing access changed'; end if;
end;
$$;
rollback;
