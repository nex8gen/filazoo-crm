-- Run against a migrated database. Every fixture and payment is rolled back.
begin;
set local role service_role;
do $$
declare
  actor uuid;
  inv public.invoices;
  inv2 public.invoices;
  payment_id uuid := gen_random_uuid();
  payment jsonb;
  result jsonb;
begin
  select user_id into actor from public.workspace_members where role in ('admin','operator') and activated_at is not null limit 1;
  if actor is null then raise exception 'Test requires an active billing member.'; end if;
  insert into public.invoices(number,document,total_minor,created_by) overriding system value
    values(-1, '{"customerName":"ROLLBACK TEST","currency":"USD","dueDate":"2026-10-22"}', 1000, actor) returning * into inv;
  perform public.mutate_invoice(inv.id, actor, jsonb_build_object('action','save','revision',1,'document',inv.document,'totalMinor',1200));
  begin
    perform public.mutate_invoice(inv.id, actor, jsonb_build_object('action','issue','revision',1));
    raise exception 'TEST FAILED: stale revision accepted';
  exception when raise_exception then
    if sqlerrm not like 'This invoice changed.%' then raise; end if;
  end;
  perform public.mutate_invoice(inv.id, actor, jsonb_build_object('action','issue','revision',2));
  begin
    perform public.mutate_invoice(inv.id, actor, jsonb_build_object('action','save','revision',3,'document',inv.document,'totalMinor',10));
    raise exception 'TEST FAILED: issued edit accepted';
  exception when raise_exception then
    if sqlerrm <> 'Only drafts can be edited.' then raise; end if;
  end;
  payment := jsonb_build_object('id', payment_id, 'amountMinor', 500, 'paidOn', current_date, 'method', 'bank_transfer', 'reference','test');
  perform public.mutate_invoice(inv.id, actor, jsonb_build_object('action','payment','payment',payment));
  perform public.mutate_invoice(inv.id, actor, jsonb_build_object('action','payment','payment',payment));
  select * into inv from public.invoices where id = inv.id;
  if inv.paid_minor <> 500 or inv.revision <> 4 then raise exception 'TEST FAILED: payment retry duplicated'; end if;
  begin
    perform public.mutate_invoice(inv.id, actor, jsonb_build_object('action','payment','payment',payment || '{"amountMinor":600}'::jsonb));
    raise exception 'TEST FAILED: conflicting payment key accepted';
  exception when raise_exception then
    if sqlerrm <> 'Payment reference was already used for a different payment.' then raise; end if;
  end;
  begin
    perform public.mutate_invoice(inv.id, actor, jsonb_build_object('action','payment','payment',payment || jsonb_build_object('id',gen_random_uuid(),'amountMinor',701)));
    raise exception 'TEST FAILED: overpayment accepted';
  exception when raise_exception then
    if sqlerrm <> 'Payment exceeds the outstanding balance or is invalid.' then raise; end if;
  end;
  begin
    perform public.mutate_invoice(inv.id, actor, jsonb_build_object('action','void','revision',4));
    raise exception 'TEST FAILED: paid invoice voided';
  exception when raise_exception then
    if sqlerrm <> 'Only an unpaid issued invoice can be voided.' then raise; end if;
  end;
  perform public.mutate_invoice(inv.id, actor, jsonb_build_object('action','payment','payment',payment || jsonb_build_object('id',gen_random_uuid(),'amountMinor',700)));
  select * into inv from public.invoices where id = inv.id;
  if inv.paid_minor <> 1200 then raise exception 'TEST FAILED: final balance incorrect'; end if;
  begin
    perform public.mutate_invoice(inv.id, gen_random_uuid(), '{"action":"void","revision":5}');
    raise exception 'TEST FAILED: unauthorized actor accepted';
  exception when raise_exception then
    if sqlerrm <> 'Billing access denied.' then raise; end if;
  end;
  insert into public.invoices(number,document,total_minor,created_by) overriding system value
    values(-2, inv.document, 1000, actor) returning * into inv2;
  perform public.mutate_invoice(inv2.id, actor, '{"action":"issue","revision":1}');
  perform public.mutate_invoice(inv2.id, actor, '{"action":"void","revision":2}');
  select * into inv2 from public.invoices where id = inv2.id;
  if inv2.status <> 'void' then raise exception 'TEST FAILED: void transition'; end if;
  insert into public.invoices(number,document,total_minor,created_by) overriding system value
    values(-3, inv.document, 1000, actor) returning * into inv2;
  perform public.mutate_invoice(inv2.id, actor, '{"action":"delete","revision":1}');
  if exists(select 1 from public.invoices where id = inv2.id) then raise exception 'TEST FAILED: draft not deleted'; end if;
end;
$$;
set local role anon;
do $$ begin
  begin
    perform 1 from public.invoices;
    raise exception 'TEST FAILED: anonymous invoice read allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mutate_invoice(gen_random_uuid(),gen_random_uuid(),'{}');
    raise exception 'TEST FAILED: anonymous mutation allowed';
  exception when insufficient_privilege then null; end;
end; $$;
set local role authenticated;
do $$ begin
  begin
    insert into public.invoices(document,total_minor) values('{}',1);
    raise exception 'TEST FAILED: direct authenticated write allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.invoice_payments;
    raise exception 'TEST FAILED: direct authenticated payment read allowed';
  exception when insufficient_privilege then null; end;
end; $$;
rollback;
