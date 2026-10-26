begin;
-- Older printed QR codes contain the invoice UUID itself. Preserve that bearer
-- link only for the invoices issued before this migration, bound to the original
-- billing email. Newly created invoices must use signed customer links.
create table public.customer_portal_legacy_links (
  invoice_id uuid primary key references public.invoices(id) on delete cascade,
  billing_email text not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.customer_portal_legacy_links enable row level security;
revoke all on public.customer_portal_legacy_links from public, anon, authenticated;
grant all on public.customer_portal_legacy_links to service_role;
insert into public.customer_portal_legacy_links(invoice_id,billing_email)
select id, lower(btrim(document->>'customerEmail')) from public.invoices
where status in ('issued','void') and nullif(btrim(document->>'customerEmail'),'') is not null;
commit;
