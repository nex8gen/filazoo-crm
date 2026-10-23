begin;

alter table public.invoices add column creator_name text;

-- Recover names for existing invoices from the recorded creator, never the viewer.
update public.invoices i
set creator_name = nullif(btrim(m.display_name), '')
from public.workspace_members m
where m.user_id = i.created_by;

create function public.invoice_creator_signature()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select nullif(btrim(m.display_name), '') into new.creator_name
    from public.workspace_members m where m.user_id = new.created_by;
  elsif new.creator_name is distinct from old.creator_name then
    raise exception 'The invoice creator signature cannot be changed.';
  end if;
  return new;
end;
$$;
revoke all on function public.invoice_creator_signature() from public, anon, authenticated;
grant execute on function public.invoice_creator_signature() to service_role;
create trigger invoices_creator_signature
before insert or update of creator_name on public.invoices
for each row execute function public.invoice_creator_signature();

comment on column public.invoices.creator_name is 'Creator display name captured for the automatically rendered invoice signature.';

commit;
