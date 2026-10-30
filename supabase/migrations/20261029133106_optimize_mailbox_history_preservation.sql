create or replace function public.preserve_mailbox_history() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.uid_validity is distinct from new.uid_validity then
    return new;
  end if;

  select coalesce(jsonb_agg(value order by source_rank, item_order), '[]'::jsonb)
  into new.messages
  from (
    select value, source_rank, item_order
    from (
      select distinct on (item_key) value, source_rank, item_order
      from (
        select value,
          coalesce(value->>'id', md5(value::text)) as item_key,
          0 as source_rank,
          ordinality as item_order
        from jsonb_array_elements(coalesce(new.messages, '[]'::jsonb)) with ordinality
        union all
        select value,
          coalesce(value->>'id', md5(value::text)) as item_key,
          1 as source_rank,
          ordinality as item_order
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
