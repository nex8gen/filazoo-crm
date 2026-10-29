begin;
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_role text not null,
  access_key text not null,
  mode text not null check (mode in ('chat','agent','customer')),
  pathname text not null,
  page_context jsonb not null default '{}'::jsonb,
  scope text not null,
  title text not null default 'New conversation' check (char_length(title) between 1 and 120),
  pinned boolean not null default false,
  archived boolean not null default false,
  summary text not null default '' check (char_length(summary) <= 5000),
  version integer not null default 0,
  active_request uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_conversations_owner_scope on public.ai_conversations(user_id,owner_role,scope,archived,pinned desc,updated_at desc,id);
create index ai_conversations_search on public.ai_conversations using gin (to_tsvector('simple',title));
create table public.ai_chat_turns (
  request_id uuid primary key,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  status text not null check (status in ('pending','completed','failed')),
  response jsonb,
  created_at timestamptz not null default now()
);
create index ai_chat_turns_conversation on public.ai_chat_turns(conversation_id);
create table public.ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  turn integer not null,
  role text not null check (role in ('user','assistant')),
  content text not null check (char_length(content) <= 40000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(conversation_id,turn,role)
);
create index ai_chat_messages_search on public.ai_chat_messages using gin (to_tsvector('simple',content));
create table public.ai_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  request_id uuid not null,
  call_index integer not null,
  provider text not null,
  model text not null,
  input_tokens bigint check (input_tokens >= 0),
  output_tokens bigint check (output_tokens >= 0),
  total_tokens bigint check (total_tokens >= 0),
  estimated_cost_usd numeric check (estimated_cost_usd >= 0),
  success boolean not null,
  created_at timestamptz not null default now(),
  unique(request_id,call_index)
);
create index ai_usage_events_owner_created on public.ai_usage_events(user_id,created_at desc);
create index ai_usage_events_conversation on public.ai_usage_events(conversation_id);
alter table public.workspace_agent_actions add column conversation_id uuid references public.ai_conversations(id) on delete set null;
create index workspace_agent_actions_conversation on public.workspace_agent_actions(conversation_id,user_id,created_at);

-- All reads and writes use authenticated server routes which also recheck record
-- access and current membership. Clients cannot forge transcripts, costs or actions.
alter table public.ai_conversations enable row level security;
alter table public.ai_chat_turns enable row level security;
alter table public.ai_chat_messages enable row level security;
alter table public.ai_usage_events enable row level security;
revoke all on public.ai_conversations,public.ai_chat_turns,public.ai_chat_messages,public.ai_usage_events from public,anon,authenticated;
grant all on public.ai_conversations,public.ai_chat_turns,public.ai_chat_messages,public.ai_usage_events to service_role;
grant usage,select on sequence public.ai_usage_events_id_seq to service_role;

create function public.begin_ai_chat_turn(p_user_id uuid,p_conversation_id uuid,p_request_id uuid,p_version integer) returns jsonb
language plpgsql security invoker set search_path = public,pg_temp as $$
declare c public.ai_conversations; t public.ai_chat_turns;
begin
  select * into c from public.ai_conversations where id=p_conversation_id and user_id=p_user_id for update;
  if not found then raise exception 'Conversation unavailable'; end if;
  select * into t from public.ai_chat_turns where request_id=p_request_id;
  if found then
    if t.conversation_id <> c.id then raise exception 'Request ID already used'; end if;
    if t.status='completed' then return jsonb_build_object('response',t.response); end if;
    raise exception 'This request is pending or failed. Reload history before sending again';
  end if;
  if c.active_request is not null then raise exception 'A previous request is still pending. Reload history or start a new chat'; end if;
  if c.archived or c.version <> p_version then raise exception 'Conversation changed. Reload history before sending again'; end if;
  insert into public.ai_chat_turns(request_id,conversation_id,status) values(p_request_id,c.id,'pending');
  update public.ai_conversations set active_request=p_request_id where id=c.id;
  return '{}'::jsonb;
end; $$;

create function public.finish_ai_chat_turn(p_user_id uuid,p_conversation_id uuid,p_request_id uuid,p_user_message jsonb,p_response jsonb,p_summary text) returns void
language plpgsql security invoker set search_path = public,pg_temp as $$
declare c public.ai_conversations; action_id uuid;
begin
  select * into c from public.ai_conversations where id=p_conversation_id and user_id=p_user_id for update;
  if not found then raise exception 'Conversation unavailable'; end if;
  if exists(select 1 from public.ai_chat_turns where request_id=p_request_id and conversation_id=c.id and status='completed') then return; end if;
  if c.active_request is distinct from p_request_id then raise exception 'Request does not own conversation'; end if;
  if jsonb_typeof(p_response->'output') <> 'string' then raise exception 'Missing assistant reply'; end if;
  for action_id in select (x->>'id')::uuid from jsonb_array_elements(coalesce(p_response->'actions','[]'::jsonb)) x loop
    update public.workspace_agent_actions set conversation_id=c.id where id=action_id and user_id=p_user_id and (conversation_id is null or conversation_id=c.id);
    if not found then raise exception 'Action does not belong to conversation owner'; end if;
  end loop;
  insert into public.ai_chat_messages(id,conversation_id,turn,role,content,metadata)
    values(p_request_id,c.id,c.version+1,'user',coalesce(p_user_message->>'content',''),jsonb_build_object('attachmentNames',coalesce(p_user_message->'attachmentNames','[]'::jsonb)));
  insert into public.ai_chat_messages(conversation_id,turn,role,content,metadata)
    values(c.id,c.version+1,'assistant',p_response->>'output',p_response-'output'-'history');
  update public.ai_chat_turns set status='completed',response=p_response where request_id=p_request_id and conversation_id=c.id;
  update public.ai_conversations set version=version+1,active_request=null,updated_at=now(),summary=left(p_summary,5000),
    title=case when version=0 and title='New conversation' then left(coalesce(nullif(btrim(p_user_message->>'content'),''),'Image conversation'),120) else title end where id=c.id;
end; $$;

create function public.fail_ai_chat_turn(p_user_id uuid,p_conversation_id uuid,p_request_id uuid) returns void
language plpgsql security invoker set search_path = public,pg_temp as $$
begin
  perform 1 from public.ai_conversations where id=p_conversation_id and user_id=p_user_id and active_request=p_request_id for update;
  if not found then return; end if;
  update public.ai_chat_turns set status='failed' where request_id=p_request_id and conversation_id=p_conversation_id and status='pending';
  update public.ai_conversations set active_request=null where id=p_conversation_id;
end; $$;

create function public.ai_chat_usage_totals(p_user_id uuid,p_since timestamptz) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('requests',count(distinct request_id),'calls',count(*),'failedCalls',count(*) filter(where not success),
    'inputTokens',coalesce(sum(input_tokens),0),'outputTokens',coalesce(sum(output_tokens),0),'totalTokens',coalesce(sum(total_tokens),0),
    'unreportedCalls',count(*) filter(where total_tokens is null),'estimatedCostUsd',sum(estimated_cost_usd),
    'unpricedCalls',count(*) filter(where estimated_cost_usd is null))
  from public.ai_usage_events where user_id=p_user_id and created_at >= p_since;
$$;
revoke all on function public.begin_ai_chat_turn(uuid,uuid,uuid,integer),public.finish_ai_chat_turn(uuid,uuid,uuid,jsonb,jsonb,text),public.fail_ai_chat_turn(uuid,uuid,uuid),public.ai_chat_usage_totals(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.begin_ai_chat_turn(uuid,uuid,uuid,integer),public.finish_ai_chat_turn(uuid,uuid,uuid,jsonb,jsonb,text),public.fail_ai_chat_turn(uuid,uuid,uuid),public.ai_chat_usage_totals(uuid,timestamptz) to service_role;

create function public.search_ai_conversations(p_user_id uuid,p_role text,p_access_key text,p_scope text,p_archived boolean,p_search text,p_offset integer) returns setof public.ai_conversations
language sql stable security invoker set search_path=public,pg_temp as $$
  select c.* from public.ai_conversations c
  where c.user_id=p_user_id and c.owner_role=p_role and c.access_key=p_access_key and c.scope=p_scope and c.archived=p_archived
    and (p_search='' or to_tsvector('simple',c.title) @@ plainto_tsquery('simple',p_search)
      or exists(select 1 from public.ai_chat_messages m where m.conversation_id=c.id and to_tsvector('simple',m.content) @@ plainto_tsquery('simple',p_search)))
  order by c.pinned desc,c.updated_at desc,c.id limit 31 offset greatest(0,least(p_offset,10000));
$$;
revoke all on function public.search_ai_conversations(uuid,text,text,text,boolean,text,integer) from public,anon,authenticated;
grant execute on function public.search_ai_conversations(uuid,text,text,text,boolean,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
