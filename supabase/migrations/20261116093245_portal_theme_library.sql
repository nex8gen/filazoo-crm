begin;
alter table public.workspace_portal_designs
  add column themes jsonb not null default '[]'::jsonb check (jsonb_typeof(themes) = 'array' and jsonb_array_length(themes) <= 20),
  add column live_theme_id text;
-- Preserve existing drafts and published snapshots as the first library theme.
update public.workspace_portal_designs set
  themes = jsonb_build_array(jsonb_build_object('id','current','name','My customer portal','design',draft,'updatedAt',updated_at)),
  live_theme_id = case when published is not null then 'current' else null end;
notify pgrst, 'reload schema';
commit;
