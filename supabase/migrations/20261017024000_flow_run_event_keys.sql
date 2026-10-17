begin;
alter table public.flow_runs add column if not exists event_key text;
create unique index if not exists flow_runs_event_key_idx on public.flow_runs(flow_id,event_key) where event_key is not null;
commit;
