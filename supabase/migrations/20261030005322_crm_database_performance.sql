-- Small CRM tables: keep lock waits bounded rather than delaying live traffic.
set lock_timeout = '5s';
set statement_timeout = '30s';

create index if not exists agent_reply_requests_company_id_idx on public.agent_reply_requests(company_id);
create index if not exists agent_reply_requests_invoice_id_idx on public.agent_reply_requests(invoice_id);
create index if not exists agent_reply_requests_task_id_idx on public.agent_reply_requests(task_id);
create index if not exists company_segments_created_by_idx on public.company_segments(created_by);
create index if not exists erp_connection_settings_updated_by_idx on public.erp_connection_settings(updated_by);
create index if not exists erp_inventory_run_id_idx on public.erp_inventory(run_id);
create index if not exists user_product_overrides_product_sku_idx on public.user_product_overrides(product_sku);

-- Existing deployments still submit a complete snapshot for empty IMAP polls.
-- Skip the expensive merge when the history is identical; new deployments also
-- omit the messages column entirely for empty polls, avoiding TOAST rewrites.
create or replace function public.preserve_mailbox_history() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.uid_validity is distinct from new.uid_validity then
    return new;
  end if;
  if old.messages is not distinct from new.messages then
    return new;
  end if;

  select coalesce(jsonb_agg(value order by source_rank, item_order), '[]'::jsonb)
  into new.messages
  from (
    select value, source_rank, item_order
    from (
      select distinct on (item_key) value, source_rank, item_order
      from (
        select value, coalesce(value->>'id', md5(value::text)) as item_key,
          0 as source_rank, ordinality as item_order
        from jsonb_array_elements(coalesce(new.messages, '[]'::jsonb)) with ordinality
        union all
        select value, coalesce(value->>'id', md5(value::text)) as item_key,
          1 as source_rank, ordinality as item_order
        from jsonb_array_elements(coalesce(old.messages, '[]'::jsonb)) with ordinality
      ) candidates
      order by item_key, source_rank, item_order
    ) deduplicated
    order by source_rank, item_order
    limit 5000
  ) bounded;
  return new;
end;
$$;

revoke all on function public.preserve_mailbox_history() from public, anon, authenticated;
grant execute on function public.preserve_mailbox_history() to service_role;
