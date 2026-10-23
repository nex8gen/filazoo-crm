-- All fixtures and temporary profile changes are rolled back.
begin;
set local role service_role;
do $$
declare
  actor uuid;
  expected_name text;
  inv public.invoices;
  saved public.invoices;
  next_inv public.invoices;
begin
  select user_id, nullif(btrim(display_name), '') into actor, expected_name
  from public.workspace_members
  where role in ('admin','operator') and activated_at is not null
    and nullif(btrim(display_name), '') is not null limit 1;
  if actor is null then raise exception 'Test requires a named billing member.'; end if;
  insert into public.invoices(number,document,total_minor,created_by,creator_name) overriding system value
  values(-910031, '{"customerName":"SIGNATURE ROLLBACK TEST","currency":"USD"}', 1000, actor, 'Untrusted client name') returning * into inv;
  if inv.creator_name is distinct from expected_name then raise exception 'TEST FAILED: creator signature was not captured from the member'; end if;
  update public.workspace_members set display_name = 'Temporary renamed member' where user_id = actor;
  perform public.mutate_invoice(inv.id, actor, jsonb_build_object('action','save','revision',1,'document',inv.document,'totalMinor',1000));
  select * into saved from public.invoices i where i.id = inv.id;
  if saved.creator_name is distinct from expected_name then raise exception 'TEST FAILED: existing signature changed after profile rename or draft edit'; end if;
  insert into public.invoices(number,document,total_minor,created_by) overriding system value
  values(-910032, '{"customerName":"SIGNATURE ROLLBACK TEST","currency":"USD"}', 1000, actor) returning * into next_inv;
  if next_inv.creator_name <> 'Temporary renamed member' then raise exception 'TEST FAILED: new invoice did not capture current creator name'; end if;
  begin
    update public.invoices set creator_name = 'Replacement name' where id = inv.id;
    raise exception 'TEST FAILED: signature replacement accepted';
  exception when raise_exception then
    if sqlerrm <> 'The invoice creator signature cannot be changed.' then raise; end if;
  end;
  if has_table_privilege('anon','public.invoices','SELECT') or has_table_privilege('authenticated','public.invoices','UPDATE') then
    raise exception 'TEST FAILED: invoice table has browser access';
  end if;
end;
$$;
rollback;
