-- Apply this migration only if supabase/schema.sql was already installed.
begin;

alter table public.company_profiles
  drop constraint if exists company_profiles_fit_score_check;

update public.company_profiles
set fit_score = greatest(1, least(10, round(fit_score / 10.0)::integer))
where fit_score > 10;

alter table public.company_profiles
  add constraint company_profiles_fit_score_check
  check (fit_score is null or fit_score between 1 and 10);

alter table public.pipeline
  drop constraint if exists pipeline_stage_check;

update public.pipeline
set stage = case stage
  when 'qualified' then 'interested'
  when 'sample' then 'interested'
  when 'negotiation' then 'big_order'
  else stage
end;

alter table public.pipeline
  add constraint pipeline_stage_check
  check (stage in ('new','contacted','replied','interested','big_order','won','lost'));

commit;
