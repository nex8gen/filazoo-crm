-- Run against the CRM database. All test data is rolled back.
begin;
do $$
declare
  segment_id uuid;
  segment_name text := 'Segment verification ' || gen_random_uuid()::text;
  saved_rules jsonb := '{"country":"United States","stage":"interested","minFitScore":8,"hasEmail":false}'::jsonb;
begin
  assert (select relrowsecurity from pg_class where oid = 'public.company_segments'::regclass), 'RLS must be enabled';
  assert not has_table_privilege('anon', 'public.company_segments', 'SELECT'), 'Anonymous clients must not read segments';
  assert not has_table_privilege('authenticated', 'public.company_segments', 'INSERT'), 'Browser clients must not write segments';
  assert has_table_privilege('service_role', 'public.company_segments', 'INSERT'), 'Authorized server must be able to create segments';

  insert into public.company_segments(name, description, rules)
  values(segment_name, 'Transactional segment verification', saved_rules) returning id into segment_id;
  assert (select rules = saved_rules from public.company_segments where id = segment_id), 'Rules must round-trip including false values';
  saved_rules := jsonb_build_object('companyIds', jsonb_build_array(gen_random_uuid()::text));
  update public.company_segments set rules = saved_rules where id = segment_id;
  assert (select rules = saved_rules from public.company_segments where id = segment_id), 'Individual company IDs must round-trip';
  begin
    update public.company_segments set rules = saved_rules || '{"country":"Canada"}'::jsonb where id = segment_id;
    raise exception 'Manual and dynamic membership must not be mixed';
  exception when check_violation then null;
  end;
  begin
    insert into public.company_segments(name) values(upper(segment_name));
    raise exception 'Case-insensitive duplicate names must be rejected';
  exception when unique_violation then null;
  end;
  begin
    insert into public.company_segments(name, rules) values(segment_name || ' invalid', '{"unknownField":true}');
    raise exception 'Unknown rule fields must be rejected';
  exception when check_violation then null;
  end;
end;
$$;
rollback;
select 'Segment persistence, duplicate protection, rule constraints and server-only access passed.' as result;
