begin;
create table public.workspace_agent_actions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action jsonb not null,
  approval_mode text not null check (approval_mode in ('ask', 'auto')),
  approval text check (approval in ('manual', 'auto')),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed', 'declined')),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  finished_at timestamptz
);
create index workspace_agent_actions_user_created on public.workspace_agent_actions(user_id, created_at desc);
alter table public.workspace_agent_actions enable row level security;
-- All proposal creation, approval, claiming and execution go through authenticated
-- server routes. Browser clients must not forge a proposal or reset its status.
revoke all on public.workspace_agent_actions from anon, authenticated;
grant all on public.workspace_agent_actions to service_role;
commit;
