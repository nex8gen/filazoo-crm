begin;
alter table public.company_segments drop constraint company_segments_rules_check;
alter table public.company_segments add constraint company_segments_rules_check check (
  jsonb_typeof(rules) = 'object'
  and rules - array['businessSegment','country','source','stage','minFitScore','hasEmail','companyIds'] = '{}'::jsonb
  and (not (rules ? 'companyIds') or (jsonb_typeof(rules->'companyIds') = 'array' and rules - 'companyIds' = '{}'::jsonb))
);
commit;
