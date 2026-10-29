-- Filazoo CRM production schema. Run once in the Supabase SQL Editor.
-- CRM tables are server-only. The publishable key is reserved for Auth.

begin;
create schema if not exists extensions;
create extension if not exists citext with schema extensions;

create or replace function public.set_updated_at() returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Saved audiences are evaluated against current company profiles.
-- Like other CRM tables, access is server-only after workspace authorization.
create table public.company_segments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120 and name = btrim(name)),
  description text not null default '' check (char_length(description) <= 500),
  rules jsonb not null default '{}'::jsonb check (
    jsonb_typeof(rules) = 'object'
    and rules - array['businessSegment','country','source','stage','minFitScore','hasEmail','companyIds'] = '{}'::jsonb
    and (not (rules ? 'companyIds') or (jsonb_typeof(rules->'companyIds') = 'array' and rules - 'companyIds' = '{}'::jsonb))
  ),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index company_segments_name_key on public.company_segments (lower(name));
alter table public.company_segments enable row level security;
revoke all on public.company_segments from public, anon, authenticated;
grant all on public.company_segments to service_role;
comment on table public.company_segments is 'Server-only saved CRM audiences. Server actions validate active workspace membership and writer roles; browsers have no direct access.';

create table public.workspace_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('admin','operator','bd_manager','viewer')),
  display_name text,
  auto_assign_leads boolean not null default false,
  activated_at timestamptz,
  last_lead_assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_mailboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  type text not null check (type in ('workspace','personal')),
  email citext not null unique,
  display_name text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  provider text not null default 'smtp' check (provider in ('smtp','google','microsoft','other')),
  notes text,
  smtp_host text,
  smtp_port integer,
  smtp_username text,
  smtp_password text,
  imap_host text,
  imap_port integer,
  imap_username text,
  imap_password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_inbox_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_key text not null,
  category text check (category is null or category in ('Needs follow-up','Waiting on customer','Interested','Big order','No action')),
  starred boolean not null default false,
  is_read boolean not null default false,
  folder text not null default 'inbox' check (folder in ('inbox','archive','trash')),
  follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, message_key)
);

create table public.email_automation_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.flows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  trigger_type text not null check (trigger_type in ('email_received','category_changed','no_reply','lead_added_to_list','company_segment_changed','pipeline_stage_changed')),
  trigger_config jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','live','paused')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.flow_steps (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows(id) on delete cascade,
  position integer not null check (position >= 0),
  type text not null check (type in ('wait','if_condition','send_email','create_task','change_category','internal_alert','stop')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (flow_id, position)
);

create table public.mailbox_sent_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mailbox_id uuid references public.workspace_mailboxes(id) on delete set null,
  message_id text,
  thread_key text,
  in_reply_to text,
  reference_ids text[] not null default '{}',
  from_email citext not null,
  to_email citext not null,
  subject text not null,
  body text not null default '',
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  status text not null default 'sent' check (status in ('sent','failed')),
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(), name text not null, website text,
  domain citext unique, linkedin_url text, country text, city text, segment text,
  employee_count integer check (employee_count is null or employee_count >= 0),
  source text, source_url text,
  status text not null default 'new' check (status in ('new','researching','qualified','contacted','engaged','customer','disqualified')),
  discovered_at timestamptz not null default now(), last_verified_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text, role text, email citext not null unique, linkedin_url text,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','valid','risky','invalid','unknown')),
  verification_provider text, verified_at timestamptz,
  confidence numeric(5,2) check (confidence is null or confidence between 0 and 100),
  unsubscribed boolean not null default false, consent_source text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.flow_runs (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows(id) on delete cascade,
  conversation_id text not null,
  event_key text,
  contact_id uuid references public.contacts(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  current_step integer not null default 0 check (current_step >= 0),
  status text not null default 'active' check (status in ('active','done','cancelled','failed')),
  next_run_at timestamptz,
  context jsonb not null default '{}'::jsonb,
  locked_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.crm_tasks (
  id uuid primary key default gen_random_uuid(), flow_run_id uuid references public.flow_runs(id) on delete set null,
  company_id uuid references public.companies(id) on delete cascade, contact_id uuid references public.contacts(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null, title text not null check (char_length(title) between 1 and 200),
  notes text, priority text not null default 'normal' check (priority in ('low','normal','high')),
  status text not null default 'open' check (status in ('open','done','cancelled')), due_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.internal_notifications (
  id uuid primary key default gen_random_uuid(), flow_run_id uuid references public.flow_runs(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade, channel text not null default 'in_app' check (channel in ('in_app','email')),
  message text not null check (char_length(message) between 1 and 500), conversation_id text,
  include_thread_link boolean not null default true, read_at timestamptz, created_at timestamptz not null default now()
);

create table public.flow_run_logs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.flow_runs(id) on delete cascade,
  step_id uuid references public.flow_steps(id) on delete set null,
  result jsonb,
  error text,
  created_at timestamptz not null default now()
);

create table public.company_profiles (
  company_id uuid primary key references public.companies(id) on delete cascade,
  summary text, products_they_print text, likely_materials text[] not null default array[]::text[],
  likely_products text[] not null default array[]::text[], company_size text,
  fit_score integer check (fit_score is null or fit_score between 1 and 10),
  interest_tags text[] not null default array[]::text[], evidence jsonb not null default '[]'::jsonb,
  model_name text, profiled_at timestamptz, updated_at timestamptz not null default now()
);

create table public.products (
  sku text primary key, name text not null, material text, color text, diameter text, weight text,
  price numeric(12,2) check (price is null or price >= 0), currency char(3) not null default 'USD',
  moq integer check (moq is null or moq >= 0), stock_status text, lead_time text,
  tags text[] not null default array[]::text[], description text, image_url text,
  active boolean not null default true, sheet_updated_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.product_sync_runs (
  id uuid primary key default gen_random_uuid(), status text not null check (status in ('running','succeeded','failed')),
  rows_seen integer not null default 0, rows_changed integer not null default 0,
  error_message text, started_at timestamptz not null default now(), finished_at timestamptz
);

create table public.catalogs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  product_skus text[] not null default array[]::text[], pdf_url text, currency char(3) not null default 'USD',
  price_date date not null default current_date, version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now()
);

create table public.emails (
  id uuid primary key default gen_random_uuid(), contact_id uuid not null references public.contacts(id) on delete cascade,
  catalog_id uuid references public.catalogs(id) on delete set null,
  direction text not null check (direction in ('sent','received')), subject text, body text,
  thread_id text, message_id text unique,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','scheduled','sent','received','failed','cancelled')),
  step integer not null default 1 check (step > 0), scheduled_for timestamptz,
  approved_by uuid references auth.users(id) on delete set null, approved_at timestamptz,
  sent_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.pipeline (
  company_id uuid primary key references public.companies(id) on delete cascade,
  stage text not null default 'new' check (stage in ('new','contacted','replied','interested','big_order','won','lost')),
  notes text, estimated_value numeric(14,2) check (estimated_value is null or estimated_value >= 0),
  estimated_order_quantity integer check (estimated_order_quantity is null or estimated_order_quantity >= 0),
  currency char(3) not null default 'USD', next_followup_at timestamptz,
  owner_id uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null, type text not null,
  data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create table public.meta_messages (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,
  thread_id text not null,
  page_id text not null,
  sender_id text not null,
  recipient_id text not null,
  customer_name text,
  direction text not null check (direction in ('inbound','outbound')),
  body text not null,
  message_type text not null default 'text',
  status text not null default 'received' check (status in ('received','sent','failed')),
  source text not null default 'facebook_messenger' check (source in ('facebook_messenger','instagram_messaging')),
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.meta_leads (
  leadgen_id text primary key,
  page_id text not null,
  form_id text,
  ad_id text,
  adgroup_id text,
  full_name text,
  email text,
  phone text,
  owner_id uuid references auth.users(id) on delete set null,
  assignment_method text check (assignment_method is null or assignment_method in ('automatic','manual')),
  field_data jsonb not null default '[]'::jsonb,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shopify_leads (
  webhook_id text primary key,
  shop_domain text not null,
  customer_id text not null,
  email citext not null,
  company_name text not null,
  full_name text,
  phone text,
  owner_id uuid references auth.users(id) on delete set null,
  assignment_method text check (assignment_method is null or assignment_method in ('automatic','manual')),
  tags text[] not null default '{}',
  status text not null default 'processing' check (status in ('processing','processed','failed')),
  company_id uuid references public.companies(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  error_message text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.suppression (
  email citext primary key, reason text not null, source text, created_at timestamptz not null default now()
);

create index companies_status_idx on public.companies(status);
create index companies_segment_country_idx on public.companies(segment,country);
create index contacts_company_id_idx on public.contacts(company_id);
create index contacts_verification_status_idx on public.contacts(verification_status);
create index emails_contact_id_idx on public.emails(contact_id);
create index emails_catalog_id_idx on public.emails(catalog_id);
create index emails_approved_by_idx on public.emails(approved_by);
create index emails_status_scheduled_for_idx on public.emails(status,scheduled_for);
create index email_inbox_state_user_updated_idx on public.email_inbox_state(user_id,updated_at desc);
create index mailbox_sent_messages_user_sent_idx on public.mailbox_sent_messages(user_id,sent_at desc);
create index mailbox_sent_messages_mailbox_id_idx on public.mailbox_sent_messages(mailbox_id);
create index mailbox_sent_messages_thread_key_idx on public.mailbox_sent_messages(user_id,thread_key);
create index flows_user_updated_idx on public.flows(user_id,updated_at desc);
create index flows_created_by_idx on public.flows(created_by);
create index flow_steps_flow_position_idx on public.flow_steps(flow_id,position);
create index flow_runs_flow_id_idx on public.flow_runs(flow_id);
create index flow_runs_contact_id_idx on public.flow_runs(contact_id);
create index flow_runs_company_id_idx on public.flow_runs(company_id);
create index crm_tasks_contact_id_idx on public.crm_tasks(contact_id);
create index crm_tasks_flow_run_id_idx on public.crm_tasks(flow_run_id);
create index internal_notifications_flow_run_id_idx on public.internal_notifications(flow_run_id);
create index flow_runs_due_idx on public.flow_runs(status,next_run_at) where status = 'active';
create index flow_runs_conversation_idx on public.flow_runs(conversation_id);
create index flow_run_logs_run_created_idx on public.flow_run_logs(run_id,created_at);
create index flow_run_logs_step_id_idx on public.flow_run_logs(step_id);
create unique index flow_runs_one_active_conversation_idx on public.flow_runs(flow_id,conversation_id) where status = 'active';
create unique index flow_runs_event_key_idx on public.flow_runs(flow_id,event_key) where event_key is not null;
create index events_company_created_at_idx on public.events(company_id,created_at desc);
create index events_actor_id_idx on public.events(actor_id);
create index meta_messages_thread_created_at_idx on public.meta_messages(thread_id,created_at desc);
create index meta_messages_page_created_at_idx on public.meta_messages(page_id,created_at desc);
create index meta_messages_direction_status_idx on public.meta_messages(direction,status);
create index meta_leads_page_created_at_idx on public.meta_leads(page_id,created_at desc);
create index meta_leads_form_created_at_idx on public.meta_leads(form_id,created_at desc);
create index shopify_leads_customer_id_idx on public.shopify_leads(customer_id);
create index shopify_leads_email_created_at_idx on public.shopify_leads(email,created_at desc);
create index shopify_leads_status_created_at_idx on public.shopify_leads(status,created_at desc);
create index shopify_leads_company_id_idx on public.shopify_leads(company_id);
create index shopify_leads_contact_id_idx on public.shopify_leads(contact_id);
create index workspace_members_auto_assignment_idx on public.workspace_members(role,auto_assign_leads,last_lead_assigned_at);
create index meta_leads_owner_id_idx on public.meta_leads(owner_id);
create index shopify_leads_owner_id_idx on public.shopify_leads(owner_id);
create index pipeline_stage_idx on public.pipeline(stage);
create index pipeline_owner_id_idx on public.pipeline(owner_id);
create index catalogs_company_id_idx on public.catalogs(company_id);

create trigger workspace_members_set_updated_at before update on public.workspace_members for each row execute function public.set_updated_at();
create trigger workspace_mailboxes_set_updated_at before update on public.workspace_mailboxes for each row execute function public.set_updated_at();
create trigger email_inbox_state_set_updated_at before update on public.email_inbox_state for each row execute function public.set_updated_at();
create trigger email_automation_settings_set_updated_at before update on public.email_automation_settings for each row execute function public.set_updated_at();
create trigger flows_set_updated_at before update on public.flows for each row execute function public.set_updated_at();
create trigger companies_set_updated_at before update on public.companies for each row execute function public.set_updated_at();
create trigger contacts_set_updated_at before update on public.contacts for each row execute function public.set_updated_at();
create trigger company_profiles_set_updated_at before update on public.company_profiles for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger emails_set_updated_at before update on public.emails for each row execute function public.set_updated_at();
create trigger meta_messages_set_updated_at before update on public.meta_messages for each row execute function public.set_updated_at();
create trigger meta_leads_set_updated_at before update on public.meta_leads for each row execute function public.set_updated_at();
create trigger shopify_leads_set_updated_at before update on public.shopify_leads for each row execute function public.set_updated_at();
create trigger pipeline_set_updated_at before update on public.pipeline for each row execute function public.set_updated_at();
create trigger crm_tasks_set_updated_at before update on public.crm_tasks for each row execute function public.set_updated_at();

alter table public.workspace_members enable row level security;
alter table public.workspace_mailboxes enable row level security;
alter table public.email_inbox_state enable row level security;
alter table public.email_automation_settings enable row level security;
alter table public.flows enable row level security;
alter table public.flow_steps enable row level security;
alter table public.flow_runs enable row level security;
alter table public.flow_run_logs enable row level security;
alter table public.crm_tasks enable row level security;
alter table public.internal_notifications enable row level security;
alter table public.mailbox_sent_messages enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.company_profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_sync_runs enable row level security;
alter table public.catalogs enable row level security;
alter table public.emails enable row level security;
alter table public.meta_messages enable row level security;
alter table public.meta_leads enable row level security;
alter table public.shopify_leads enable row level security;
alter table public.pipeline enable row level security;
alter table public.events enable row level security;
alter table public.suppression enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

create or replace function public.claim_next_bd_sales_manager() returns uuid language plpgsql security invoker set search_path = public as $$
declare selected_user_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('filazoo_bd_lead_assignment'));
  select member.user_id into selected_user_id
  from public.workspace_members member
  where member.role = 'bd_manager' and member.auto_assign_leads = true and member.activated_at is not null
  order by (
    select count(*) from public.pipeline assigned_pipeline where assigned_pipeline.owner_id = member.user_id
  ) asc, member.last_lead_assigned_at asc nulls first, member.created_at asc, member.user_id asc limit 1 for update;
  if selected_user_id is not null then
    update public.workspace_members set last_lead_assigned_at = clock_timestamp() where user_id = selected_user_id;
  end if;
  return selected_user_id;
end;
$$;
revoke all on function public.claim_next_bd_sales_manager() from public, anon, authenticated;
grant execute on function public.claim_next_bd_sales_manager() to service_role;

create or replace function public.assign_unowned_leads_to_sole_bd_manager() returns trigger
language plpgsql security invoker set search_path = public as $$
declare eligible_manager_ids uuid[]; sole_manager_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('filazoo_bd_lead_assignment'));
  select array_agg(member.user_id order by member.created_at, member.user_id) into eligible_manager_ids
  from public.workspace_members member
  where member.role = 'bd_manager' and member.auto_assign_leads = true and member.activated_at is not null;
  if coalesce(cardinality(eligible_manager_ids), 0) <> 1 then return null; end if;
  sole_manager_id := eligible_manager_ids[1];
  update public.pipeline set owner_id = sole_manager_id, updated_at = clock_timestamp() where owner_id is null;
  update public.shopify_leads set owner_id = sole_manager_id, assignment_method = 'automatic', updated_at = clock_timestamp() where owner_id is null and status = 'processed';
  update public.meta_leads set owner_id = sole_manager_id, assignment_method = 'automatic', updated_at = clock_timestamp() where owner_id is null;
  return null;
end;
$$;
drop trigger if exists workspace_members_assign_unowned_to_sole_bd on public.workspace_members;
drop trigger if exists workspace_members_assign_unowned_to_sole_bd_insert on public.workspace_members;
drop trigger if exists workspace_members_assign_unowned_to_sole_bd_update on public.workspace_members;
drop trigger if exists workspace_members_assign_unowned_to_sole_bd_delete on public.workspace_members;
create trigger workspace_members_assign_unowned_to_sole_bd_insert after insert on public.workspace_members
for each statement execute function public.assign_unowned_leads_to_sole_bd_manager();
create trigger workspace_members_assign_unowned_to_sole_bd_update after update of role, auto_assign_leads, activated_at on public.workspace_members
for each statement execute function public.assign_unowned_leads_to_sole_bd_manager();
create trigger workspace_members_assign_unowned_to_sole_bd_delete after delete on public.workspace_members
for each statement execute function public.assign_unowned_leads_to_sole_bd_manager();
revoke all on function public.assign_unowned_leads_to_sole_bd_manager() from public, anon, authenticated;

commit;

begin;

-- Only the authenticated application server can invoke this transactional save.
create or replace function public.save_automation_flow(p_user_id uuid, p_flow_id uuid, p_input jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  saved_id uuid;
  definition jsonb;
begin
  if p_flow_id is null then
    insert into public.flows(user_id,created_by,name,trigger_type,trigger_config,status)
    values(p_user_id,p_user_id,p_input->>'name',p_input->>'triggerType',p_input->'triggerConfig','draft')
    returning id into saved_id;
  else
    select id into saved_id from public.flows where id=p_flow_id and user_id=p_user_id for update;
    if saved_id is null then raise exception 'Flow not found.'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'position',position,'type',type,'config',config) order by position),'[]'::jsonb)
      into definition from public.flow_steps where flow_id=saved_id;
    update public.flow_runs set context=context || jsonb_build_object('definition',definition::text)
      where flow_id=saved_id and status='active' and not (context ? 'definition');
    delete from public.flow_steps where flow_id=saved_id;
  end if;
  insert into public.flow_steps(flow_id,position,type,config)
    select saved_id,(ordinality-1)::integer,step->>'type',step->'config'
    from jsonb_array_elements(p_input->'steps') with ordinality as items(step,ordinality);
  if not exists(select 1 from public.flow_steps where flow_id=saved_id) then
    raise exception 'Add at least one step.';
  end if;
  update public.flows set name=p_input->>'name',trigger_type=p_input->>'triggerType',
    trigger_config=p_input->'triggerConfig',status=p_input->>'status',updated_at=now() where id=saved_id;
  return saved_id;
end;
$$;
revoke all on function public.save_automation_flow(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_automation_flow(uuid,uuid,jsonb) to service_role;

create index if not exists flow_run_logs_engagement_idx on public.flow_run_logs(run_id,created_at) where result->>'action' in ('email_opened','link_clicked');
create index if not exists emails_message_id_idx on public.emails(message_id);
notify pgrst, 'reload schema';
commit;


begin;

-- Internal bounded mailbox cache, shared across server instances. The API
-- resolves the viewer's authorized mailbox before accessing its opaque key.
create table if not exists public.mailbox_sync_state (
  mailbox_key text primary key,
  uid_validity bigint,
  last_uid bigint not null default 0,
  messages jsonb not null default '[]'::jsonb,
  synced_at timestamptz,
  last_error text,
  lease_token uuid,
  lease_until timestamptz,
  check (last_uid >= 0),
  check (jsonb_typeof(messages) = 'array' and jsonb_array_length(messages) <= 1000)
);
alter table public.mailbox_sync_state enable row level security;
revoke all on public.mailbox_sync_state from anon, authenticated;
grant select, insert, update, delete on public.mailbox_sync_state to service_role;

create table if not exists public.mailbox_message_content (
  mailbox_key text not null references public.mailbox_sync_state(mailbox_key) on delete cascade,
  uid_validity bigint not null,
  uid bigint not null check (uid > 0),
  content jsonb not null,
  primary key (mailbox_key, uid_validity, uid)
);
alter table public.mailbox_message_content enable row level security;
revoke all on public.mailbox_message_content from anon, authenticated;
grant select, insert, update, delete on public.mailbox_message_content to service_role;

notify pgrst, 'reload schema';
commit;

begin;

alter table public.meta_leads
  add column if not exists company_id uuid references public.companies(id) on delete set null,
  add column if not exists contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists processed_at timestamptz;
create index if not exists meta_leads_company_id_idx on public.meta_leads(company_id);
create index if not exists meta_leads_contact_id_idx on public.meta_leads(contact_id);

-- All lead ingress paths (native Meta, Make, historical import) use this one
-- transaction. A retry cannot leave a company without its contact/pipeline.
create or replace function public.link_meta_lead_company() returns trigger
language plpgsql security invoker set search_path = public, extensions, pg_temp as $$
declare
  answers jsonb;
  lead_email text;
  lead_name text;
  company_name text;
  company_website text;
  company_domain text;
  company_country text;
  company_city text;
  company_key uuid;
  contact_key uuid;
  owner_key uuid;
  order_text text;
  order_quantity integer;
begin
  if new.company_id is not null then return new; end if;
  if coalesce(nullif(btrim(new.full_name), ''), nullif(btrim(new.email), ''), nullif(btrim(new.phone), '')) is null then return new; end if;

  select coalesce(jsonb_object_agg(lower(item->>'name'), item->'values'->>0), '{}'::jsonb)
    into answers from jsonb_array_elements(new.field_data) item where item->>'name' is not null;
  lead_email := nullif(lower(btrim(new.email)), '');
  lead_name := coalesce(nullif(btrim(new.full_name), ''), lead_email, new.phone, 'Meta lead');
  company_name := coalesce(nullif(answers->>'company_name',''), nullif(answers->>'company',''), nullif(answers->>'business_name',''));
  company_website := coalesce(nullif(answers->>'website',''), nullif(answers->>'company_website',''), nullif(answers->>'business_website',''));
  if company_website is not null and company_website !~* '^https?://' then company_website := 'https://' || company_website; end if;
  if company_website ~* '^https?://([a-z0-9-]+\.)+[a-z]{2,}([/:?#]|$)' then
    company_domain := lower(regexp_replace(split_part(regexp_replace(company_website, '^https?://', '', 'i'), '/', 1), '^www\.', '', 'i'));
    company_domain := split_part(split_part(split_part(company_domain, ':', 1), '?', 1), '#', 1);
  else company_website := null;
  end if;
  if company_domain is null and lead_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    company_domain := split_part(lead_email, '@', 2);
    if company_domain = any(array['gmail.com','googlemail.com','hotmail.com','outlook.com','live.com','icloud.com','me.com','yahoo.com','qq.com','163.com','126.com','proton.me','protonmail.com','aol.com']) then company_domain := null; end if;
  end if;
  company_name := coalesce(company_name, case when company_domain is not null then initcap(replace(split_part(company_domain, '.', 1), '-', ' ')) end, lead_name || ' (Meta lead)');
  company_country := nullif(answers->>'country','');
  company_city := nullif(answers->>'city','');
  order_text := coalesce(answers->>'what_is_your_expected_initial_order_quantity?', answers->>'expected_order_quantity', answers->>'order_quantity');
  if substring(order_text from '[0-9]+') is not null then
    order_quantity := least(substring(order_text from '[0-9]+')::numeric, 2147483647)::integer;
  end if;

  -- Serialize shared identities; generic mailbox providers never merge companies.
  perform pg_advisory_xact_lock(hashtextextended('meta-company:' || coalesce(company_domain, lead_email, new.leadgen_id), 0));
  if lead_email is not null then
    select id, company_id into contact_key, company_key from public.contacts where email = lead_email::extensions.citext;
  end if;
  if company_key is null and company_domain is not null then
    select id into company_key from public.companies where domain = company_domain::extensions.citext;
  end if;
  if company_key is null then
    insert into public.companies(name, website, domain, country, city, segment, source, source_url, status, discovered_at)
    values(left(company_name, 500), company_website, company_domain, company_country, company_city,
      'Meta B2B lead', 'meta_lead_ads', 'https://www.facebook.com/' || new.page_id, 'new', new.created_at)
    returning id into company_key;
  else
    update public.companies set
      source = case when coalesce(source, '') like '%meta_lead_ads%' then source else concat_ws('+', nullif(source,''), 'meta_lead_ads') end,
      website = coalesce(website, company_website),
      country = coalesce(nullif(country,'Unknown'), company_country),
      city = coalesce(city, company_city)
    where id = company_key;
  end if;

  select owner_id into owner_key from public.pipeline where company_id = company_key for update;
  if owner_key is null then
    owner_key := case when new.assignment_method = 'manual' then new.owner_id else public.claim_next_bd_sales_manager() end;
  end if;
  insert into public.pipeline(company_id, stage, owner_id, estimated_order_quantity)
  values(company_key, 'new', owner_key, order_quantity)
  on conflict(company_id) do update set
    owner_id = coalesce(pipeline.owner_id, excluded.owner_id),
    estimated_order_quantity = coalesce(pipeline.estimated_order_quantity, excluded.estimated_order_quantity);

  if contact_key is null and lead_email is not null then
    insert into public.contacts(company_id, name, email, verification_status, consent_source)
    values(company_key, lead_name, lead_email, 'unverified', 'meta_lead_ads') returning id into contact_key;
  end if;
  insert into public.events(company_id, type, data, created_at)
  values(company_key, 'meta_lead_received', jsonb_build_object(
    'summary', lead_name || ' submitted a Meta lead form.' || case when new.phone is not null then ' Phone: ' || new.phone || '.' else '' end
      || case when order_text is not null then ' Expected order: ' || order_text || '.' else '' end,
    'leadgen_id', new.leadgen_id, 'email', lead_email, 'phone', new.phone,
    'form_id', new.form_id, 'ad_id', new.ad_id, 'details', answers), new.created_at);
  new.company_id := company_key;
  new.contact_id := contact_key;
  new.owner_id := owner_key;
  new.assignment_method := case when new.assignment_method = 'manual' then 'manual' when owner_key is not null then 'automatic' else null end;
  new.processed_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function public.link_meta_lead_company() from public, anon, authenticated;
grant execute on function public.link_meta_lead_company() to service_role;
drop trigger if exists meta_leads_link_company on public.meta_leads;
create trigger meta_leads_link_company before insert or update of email, full_name, phone, field_data, company_id
on public.meta_leads for each row execute function public.link_meta_lead_company();

commit;

-- Invoice system
begin;

-- Billing is a server-only API. Neither anonymous nor authenticated Data API
-- clients can bypass the workspace authorization in the invoice routes.
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  status text not null default 'draft' check (status in ('draft','issued','void')),
  total_minor bigint not null check (total_minor between 0 and 200000000000),
  paid_minor bigint not null default 0 check (paid_minor >= 0 and paid_minor <= total_minor),
  revision integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_status_number_idx on public.invoices(status, number desc);
create index invoices_created_by_idx on public.invoices(created_by);

create table public.invoice_payments (
  id uuid primary key,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  paid_on date not null,
  method text not null check (method in ('bank_transfer','cash','card','other')),
  reference text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index invoice_payments_invoice_idx on public.invoice_payments(invoice_id);
create index invoice_payments_created_by_idx on public.invoice_payments(created_by);

create table public.invoice_events (
  id bigint generated always as identity primary key,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  created_at timestamptz not null default now()
);
create index invoice_events_invoice_idx on public.invoice_events(invoice_id);
create index invoice_events_actor_idx on public.invoice_events(actor_id);

alter table public.invoices enable row level security;
alter table public.invoice_payments enable row level security;
alter table public.invoice_events enable row level security;
revoke all on public.invoices, public.invoice_payments, public.invoice_events from anon, authenticated;
grant all on public.invoices, public.invoice_payments, public.invoice_events to service_role;
grant usage, select on sequence public.invoices_number_seq, public.invoice_events_id_seq to service_role;

-- A single transaction and row lock protect state transitions and payment
-- balances. Revision checks prevent two open editors from overwriting a draft.
create function public.mutate_invoice(p_id uuid, p_actor uuid, p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  inv public.invoices;
  prior public.invoice_payments;
  operation text := p_input->>'action';
  payment jsonb := p_input->'payment';
  amount bigint;
  actor_role text;
begin
  select role into actor_role from public.workspace_members where user_id = p_actor and activated_at is not null;
  if actor_role is null or actor_role not in ('admin','operator','bd_manager') then
    raise exception 'Billing access denied.';
  end if;
  select * into inv from public.invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found.'; end if;
  if actor_role = 'bd_manager' and (operation is distinct from 'save' or inv.created_by is distinct from p_actor or inv.status <> 'draft') then
    raise exception 'BD managers can only edit draft invoices they created.';
  end if;
  if operation = 'payment' then
    select * into prior from public.invoice_payments where id = (payment->>'id')::uuid;
    if found then
      if prior.invoice_id <> p_id or prior.amount_minor <> (payment->>'amountMinor')::bigint
         or prior.paid_on <> (payment->>'paidOn')::date or prior.method <> payment->>'method'
         or prior.reference <> payment->>'reference' then
        raise exception 'Payment reference was already used for a different payment.';
      end if;
      return to_jsonb(inv);
    end if;
    if inv.status <> 'issued' then raise exception 'Only issued invoices can receive payments.'; end if;
    amount := (payment->>'amountMinor')::bigint;
    if amount is null or amount <= 0 or amount > inv.total_minor - inv.paid_minor then raise exception 'Payment exceeds the outstanding balance or is invalid.'; end if;
    if (payment->>'paidOn')::date > current_date then raise exception 'Payment date cannot be in the future.'; end if;
    insert into public.invoice_payments(id, invoice_id, amount_minor, paid_on, method, reference, created_by)
    values ((payment->>'id')::uuid, p_id, amount, (payment->>'paidOn')::date, payment->>'method', payment->>'reference', p_actor);
    update public.invoices set paid_minor = paid_minor + amount, revision = revision + 1, updated_at = now() where id = p_id returning * into inv;
  else
    if inv.revision <> (p_input->>'revision')::integer then raise exception 'This invoice changed. Reload it before continuing.'; end if;
    if operation = 'save' then
      if inv.status <> 'draft' then raise exception 'Only drafts can be edited.'; end if;
      update public.invoices set document = p_input->'document', total_minor = (p_input->>'totalMinor')::bigint,
        revision = revision + 1, updated_at = now() where id = p_id returning * into inv;
    elsif operation = 'issue' then
      if inv.status <> 'draft' or inv.total_minor <= 0 then raise exception 'Only a draft with a positive total can be issued.'; end if;
      update public.invoices set status = 'issued', revision = revision + 1, updated_at = now() where id = p_id returning * into inv;
    elsif operation = 'void' then
      if inv.status <> 'issued' or inv.paid_minor <> 0 then raise exception 'Only an unpaid issued invoice can be voided.'; end if;
      update public.invoices set status = 'void', revision = revision + 1, updated_at = now() where id = p_id returning * into inv;
    elsif operation = 'delete' then
      if inv.status <> 'draft' then raise exception 'Only drafts can be deleted.'; end if;
      delete from public.invoices where id = p_id;
      return null;
    else
      raise exception 'Unknown invoice action.';
    end if;
  end if;
  insert into public.invoice_events(invoice_id, actor_id, action) values(p_id, p_actor, operation);
  return to_jsonb(inv);
end;
$$;
revoke all on function public.mutate_invoice(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.mutate_invoice(uuid,uuid,jsonb) to service_role;

commit;

-- Connected invoice system
begin;
alter table public.invoices
  add column company_id uuid references public.companies(id) on delete set null,
  add column contact_id uuid references public.contacts(id) on delete set null,
  add column source_thread_id text;
create index invoices_company_number_idx on public.invoices(company_id, number desc);
create index invoices_contact_idx on public.invoices(contact_id);
create index invoices_thread_idx on public.invoices(source_thread_id) where source_thread_id is not null;

create table public.customer_billing_profiles (
  company_id uuid primary key references public.companies(id) on delete cascade,
  profile jsonb not null check(jsonb_typeof(profile)='object'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table public.invoice_settings (
  singleton boolean primary key default true check(singleton),
  settings jsonb not null check(jsonb_typeof(settings)='object'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index customer_billing_profiles_updated_by_idx on public.customer_billing_profiles(updated_by);
create index invoice_settings_updated_by_idx on public.invoice_settings(updated_by);
alter table public.customer_billing_profiles enable row level security;
alter table public.invoice_settings enable row level security;
revoke all on public.customer_billing_profiles, public.invoice_settings from anon, authenticated;
grant all on public.customer_billing_profiles, public.invoice_settings to service_role;

-- Existing snapshots can be linked only by an exact unique contact email.
-- Names and monetary content are preserved.
update public.invoices i set
  company_id=c.company_id, contact_id=c.id,
  document=i.document || jsonb_build_object('companyId',c.company_id,'contactId',c.id)
from public.contacts c where lower(btrim(i.document->>'customerEmail'))=lower(c.email::text)
  and i.company_id is null and not(i.document ? 'companyId');

create function public.link_invoice_document() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  new.company_id := nullif(new.document->>'companyId','')::uuid;
  new.contact_id := nullif(new.document->>'contactId','')::uuid;
  new.source_thread_id := nullif(new.document->>'sourceThreadId','');
  if new.contact_id is not null and (new.company_id is null or not exists(select 1 from public.contacts where id=new.contact_id and company_id=new.company_id)) then
    raise exception 'The selected contact does not belong to this customer.';
  end if;
  return new;
end; $$;
revoke all on function public.link_invoice_document() from public,anon,authenticated;
grant execute on function public.link_invoice_document() to service_role;
create trigger invoices_link_document before insert or update of document on public.invoices
for each row execute function public.link_invoice_document();

-- Financial activity appears on the customer's existing CRM timeline.
create function public.invoice_crm_activity() returns trigger
language plpgsql security invoker set search_path='' as $$
declare inv public.invoices;
begin
  select * into inv from public.invoices where id=new.invoice_id;
  if inv.company_id is not null and new.action in ('issue','payment','void') then
    insert into public.events(company_id,actor_id,type,data)
    values(inv.company_id,new.actor_id,'invoice_'||new.action,jsonb_build_object(
      'invoiceId',inv.id,'summary','INV-'||lpad(inv.number::text,6,'0')||' · '||new.action||' · '||
      btrim(inv.document->>'currency')||' '||to_char(inv.total_minor::numeric/100,'FM9999999999990.00')||
      ' total; '||to_char((inv.total_minor-inv.paid_minor)::numeric/100,'FM9999999999990.00')||' outstanding'));
  end if;
  return new;
end; $$;
revoke all on function public.invoice_crm_activity() from public,anon,authenticated;
grant execute on function public.invoice_crm_activity() to service_role;
create trigger invoice_events_crm_activity after insert on public.invoice_events
for each row execute function public.invoice_crm_activity();

create function public.invoice_receivables(p_company_id uuid default null, p_search text default '', p_status text default '')
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
    select document->>'currency' as currency,
      coalesce(sum(total_minor) filter(where status='issued'),0) as issued_minor,
      coalesce(sum(paid_minor) filter(where status='issued'),0) as paid_minor,
      coalesce(sum(total_minor-paid_minor) filter(where status='issued'),0) as outstanding_minor,
      coalesce(sum(total_minor-paid_minor) filter(where status='issued' and document->>'dueDate'<current_date::text),0) as overdue_minor
    from public.invoices
    where (p_company_id is null or company_id=p_company_id)
      and (p_search='' or document->>'customerName' ilike '%'||p_search||'%')
      and (p_status not in ('draft','issued','void') or status=p_status)
    group by document->>'currency' order by document->>'currency'
  ) t;
$$;
revoke all on function public.invoice_receivables(uuid,text,text) from public,anon,authenticated;
grant execute on function public.invoice_receivables(uuid,text,text) to service_role;
commit;

begin;

alter table public.invoices add column creator_name text;

-- Recover names for existing invoices from the recorded creator, never the viewer.
update public.invoices i
set creator_name = nullif(btrim(m.display_name), '')
from public.workspace_members m
where m.user_id = i.created_by;

create function public.invoice_creator_signature()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select nullif(btrim(m.display_name), '') into new.creator_name
    from public.workspace_members m where m.user_id = new.created_by;
  elsif new.creator_name is distinct from old.creator_name then
    raise exception 'The invoice creator signature cannot be changed.';
  end if;
  return new;
end;
$$;
revoke all on function public.invoice_creator_signature() from public, anon, authenticated;
grant execute on function public.invoice_creator_signature() to service_role;
create trigger invoices_creator_signature
before insert or update of creator_name on public.invoices
for each row execute function public.invoice_creator_signature();

comment on column public.invoices.creator_name is 'Creator display name captured for the automatically rendered invoice signature.';

commit;
begin;

create table public.invoice_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(label) between 1 and 200),
  currency text check (currency ~ '^[A-Z]{3}$'),
  details jsonb not null check (jsonb_typeof(details) = 'object'),
  active boolean not null default true,
  sort_order integer not null default 0
);
alter table public.invoice_bank_accounts enable row level security;
revoke all on public.invoice_bank_accounts from anon, authenticated;
grant all on public.invoice_bank_accounts to service_role;

insert into public.invoice_bank_accounts(label,currency,sort_order,details) values
('HSBC — Account 1',null,1,'{"beneficiaryName":"Xinrui Manufacturing Technology Limited","beneficiaryAddress":"RM 1904A, 19/F., Lucky Commercial Centre, No. 103 Des Voeux Road West, Hong Kong","accountNumber":"002148153055","bankName":"HSBC Bank (China) Company Limited, Shenzhen Branch","bankAddress":"China Resources Building, No. 5001, ShenNan Road East, LuoHu District, Shenzhen, China","swift":"HSBCCNSHSZN","bankCode":""}'::jsonb),
('CCB Asia — USD','USD',2,'{"beneficiaryName":"Xinrui Manufacturing Technology Limited","beneficiaryAddress":"RM 1904A, 19/F., Lucky Commercial Centre, No. 103 Des Voeux Road West, Hong Kong","accountNumber":"846210337118","bankName":"China Construction Bank (Asia) Corporation Limited","bankAddress":"20/F, CCB Centre, 18 Wang Chiu Road, Kowloon Bay, Kowloon, Hong Kong","swift":"CCBQHKAX","bankCode":"009"}'::jsonb),
('CCB Asia — HKD','HKD',3,'{"beneficiaryName":"Xinrui Manufacturing Technology Limited","beneficiaryAddress":"RM 1904A, 19/F., Lucky Commercial Centre, No. 103 Des Voeux Road West, Hong Kong","accountNumber":"846210337100","bankName":"China Construction Bank (Asia) Corporation Limited","bankAddress":"20/F, CCB Centre, 18 Wang Chiu Road, Kowloon Bay, Kowloon, Hong Kong","swift":"CCBQHKAX","bankCode":"009"}'::jsonb);

-- Resolve bank details on the server, rather than trusting a submitted snapshot.
create function public.invoice_bank_snapshot()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  account public.invoice_bank_accounts;
begin
  if nullif(new.document->>'bankAccountId', '') is null then
    new.document := new.document - 'bankAccount';
    return new;
  end if;
  select * into account from public.invoice_bank_accounts
  where id = (new.document->>'bankAccountId')::uuid and active;
  if not found then raise exception 'Select an active receiving bank account.'; end if;
  if account.currency is not null and account.currency <> new.document->>'currency' then
    raise exception 'Choose a bank account that matches the invoice currency.';
  end if;
  new.document := jsonb_set(new.document, '{bankAccount}', account.details ||
    jsonb_build_object('id', account.id, 'label', account.label, 'currency', account.currency));
  return new;
end;
$$;
revoke all on function public.invoice_bank_snapshot() from public, anon, authenticated;
grant execute on function public.invoice_bank_snapshot() to service_role;
create trigger invoices_bank_snapshot before insert or update of document on public.invoices
for each row execute function public.invoice_bank_snapshot();

commit;

begin;

-- Remove access and transfer ownership in one transaction. The existing pool
-- lock serializes this operation with automatic BD assignments and removals.
create or replace function public.remove_workspace_member(p_user_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  member_name text;
  company_ids uuid[];
  customer record;
  lead record;
  next_owner uuid;
  reassigned integer := 0;
  unassigned integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('filazoo_bd_lead_assignment'));
  if not exists(select 1 from public.workspace_members where user_id = p_actor_id and role = 'admin' and activated_at is not null) then
    raise exception 'Administrator access is required.';
  end if;
  if p_user_id = p_actor_id then
    raise exception 'You cannot delete your own administrator account.';
  end if;
  select display_name into member_name from public.workspace_members
    where user_id = p_user_id for update;
  if not found then raise exception 'The team member could not be found.'; end if;

  -- Capture the customers before deleting membership. Do not clear owners first:
  -- the sole-manager trigger would otherwise lose which customers need transfer.
  select array_agg(owned.company_id) into company_ids from (
    select company_id from public.pipeline where owner_id = p_user_id
    union select company_id from public.shopify_leads where owner_id = p_user_id and company_id is not null
    union select company_id from public.meta_leads where owner_id = p_user_id and company_id is not null
  ) owned;
  delete from public.workspace_members where user_id = p_user_id;

  -- Assign one customer at a time so the next choice includes the updated load.
  -- All sources for the same customer and their follow-up tasks stay together.
  for customer in select id from public.companies where id = any(company_ids) order by id for update loop
    select owner_id into next_owner from public.pipeline where company_id = customer.id for update;
    if next_owner is null or next_owner = p_user_id then
      next_owner := public.claim_next_bd_sales_manager();
      insert into public.pipeline(company_id, owner_id) values(customer.id, next_owner)
        on conflict(company_id) do update set owner_id = excluded.owner_id, updated_at = now();
    end if;
    update public.shopify_leads set owner_id = next_owner,
      assignment_method = case when next_owner is null then null else 'automatic' end,
      updated_at = now() where company_id = customer.id;
    update public.meta_leads set owner_id = next_owner,
      assignment_method = case when next_owner is null then null else 'automatic' end,
      updated_at = now() where company_id = customer.id;
    update public.crm_tasks set assigned_to = next_owner, updated_at = now()
      where company_id = customer.id and assigned_to = p_user_id;
    if next_owner is null then unassigned := unassigned + 1;
    else reassigned := reassigned + 1; end if;
    insert into public.events(company_id, actor_id, type, data)
      values(customer.id, p_actor_id, 'lead_owner_changed', jsonb_build_object(
        'previous_owner_id', p_user_id, 'owner_id', next_owner,
        'summary', case when next_owner is null then 'Customer returned to the unassigned queue after their member was removed.'
          else 'Customer automatically reassigned after their member was removed.' end));
  end loop;

  -- Older or still-processing source leads may not have a company yet.
  for lead in select webhook_id from public.shopify_leads where owner_id = p_user_id order by created_at, webhook_id for update loop
    next_owner := public.claim_next_bd_sales_manager();
    update public.shopify_leads set owner_id = next_owner,
      assignment_method = case when next_owner is null then null else 'automatic' end,
      updated_at = now() where webhook_id = lead.webhook_id;
    if next_owner is null then unassigned := unassigned + 1;
    else reassigned := reassigned + 1; end if;
  end loop;
  for lead in select leadgen_id from public.meta_leads where owner_id = p_user_id order by created_at, leadgen_id for update loop
    next_owner := public.claim_next_bd_sales_manager();
    update public.meta_leads set owner_id = next_owner,
      assignment_method = case when next_owner is null then null else 'automatic' end,
      updated_at = now() where leadgen_id = lead.leadgen_id;
    if next_owner is null then unassigned := unassigned + 1;
    else reassigned := reassigned + 1; end if;
  end loop;

  update public.crm_tasks task set assigned_to = (
    select owner_id from public.pipeline where company_id = task.company_id
  ), updated_at = now() where assigned_to = p_user_id;
  update public.flows set status = 'paused', updated_at = now() where user_id = p_user_id and status = 'live';
  update public.email_automation_settings set enabled = false, updated_at = now() where user_id = p_user_id;
  delete from public.workspace_mailboxes where user_id = p_user_id and type = 'personal';
  insert into public.events(actor_id, type, data) values(p_actor_id, 'workspace_member_deleted', jsonb_build_object(
    'target_user_id', p_user_id, 'reassigned', reassigned, 'unassigned', unassigned,
    'summary', coalesce(member_name, 'A member') || ' was removed from the workspace.'));
  return jsonb_build_object('reassigned', reassigned, 'unassigned', unassigned);
end;
$$;
revoke all on function public.remove_workspace_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_workspace_member(uuid, uuid) to service_role;

commit;


-- Lingxing ERP stock snapshots
-- ERP snapshots are separate from editable catalog/pricing data. Only the
-- authenticated application server can read or publish them.
create table public.inventory_sync_runs (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  rows_seen integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index inventory_one_running on public.inventory_sync_runs ((true)) where status = 'running';
create index inventory_sync_scope_started on public.inventory_sync_runs (scope, started_at desc);

create table public.erp_inventory (
  sku text primary key check (length(btrim(sku)) > 0),
  scope text not null,
  available bigint not null,
  on_hand bigint not null,
  locked bigint not null,
  warehouse_ids text[] not null,
  synced_at timestamptz not null,
  run_id uuid not null references public.inventory_sync_runs(id)
);
create index erp_inventory_scope_sku on public.erp_inventory(scope, sku);
alter table public.inventory_sync_runs enable row level security;
alter table public.erp_inventory enable row level security;
revoke all on public.inventory_sync_runs, public.erp_inventory from public, anon, authenticated;
grant select, insert, update, delete on public.inventory_sync_runs, public.erp_inventory to service_role;

create function public.claim_inventory_sync(p_scope text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if not pg_try_advisory_xact_lock(741850201) then return null; end if;
  update public.inventory_sync_runs
    set status = 'failed', finished_at = now(), error_message = 'Previous sync timed out. Previous stock was kept.'
    where status = 'running' and started_at <= now() - interval '5 minutes';
  if exists (select 1 from public.inventory_sync_runs where status = 'running') then return null; end if;
  if exists (select 1 from public.inventory_sync_runs where scope = p_scope and started_at > now() - interval '30 seconds') then return null; end if;
  insert into public.inventory_sync_runs(scope, status) values(p_scope, 'running') returning id into v_id;
  return v_id;
end;
$$;

create function public.finish_inventory_sync(p_run_id uuid, p_entries jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_scope text; v_started_at timestamptz;
begin
  -- Serializes publication with claim/expiry; expired workers cannot publish.
  perform pg_advisory_xact_lock(741850201);
  select scope, started_at into v_scope, v_started_at from public.inventory_sync_runs
    where id = p_run_id and status = 'running' for update;
  if v_scope is null or v_started_at <= now() - interval '5 minutes' then raise exception 'Inventory sync lease expired'; end if;
  if jsonb_typeof(p_entries) is distinct from 'array' then raise exception 'Invalid stock snapshot'; end if;
  -- Replacement and run completion commit together. Failed/incomplete pages
  -- never call this function, so the last complete snapshot stays intact.
  delete from public.erp_inventory;
  insert into public.erp_inventory(sku, scope, available, on_hand, locked, warehouse_ids, synced_at, run_id)
    select sku, v_scope, available, on_hand, locked, warehouse_ids, v_started_at, p_run_id
    from jsonb_to_recordset(p_entries) as x(sku text, available bigint, on_hand bigint, locked bigint, warehouse_ids text[]);
  update public.inventory_sync_runs set status = 'succeeded', rows_seen = jsonb_array_length(p_entries), finished_at = now()
    where id = p_run_id;
end;
$$;
revoke all on function public.claim_inventory_sync(text), public.finish_inventory_sync(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_inventory_sync(text), public.finish_inventory_sync(uuid, jsonb) to service_role;


-- Editable ERP connection and automatic stock schedule
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table public.erp_connection_settings (
  singleton boolean primary key default true check (singleton),
  provider text not null default 'lingxing' check (provider = 'lingxing'),
  name text not null,
  app_id text not null,
  app_secret_id uuid not null,
  worker_secret_id uuid not null,
  warehouse_ids text[] not null default '{}',
  sku_map jsonb not null default '{}' check (jsonb_typeof(sku_map) = 'object'),
  enabled boolean not null default true,
  sync_interval integer not null default 0 check (sync_interval in (0,5,15,60,1440)),
  worker_url text,
  revision integer not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  last_dispatched_at timestamptz,
  last_dispatch_id bigint,
  last_dispatch_error text
);
alter table public.erp_connection_settings enable row level security;
revoke all on public.erp_connection_settings from public, anon, authenticated;
grant select, insert, update, delete on public.erp_connection_settings to service_role;

-- All functions use caller privileges. Secrets are encrypted by Supabase
-- Vault, and only server service-role RPCs may retrieve the decrypted value.
create function public.read_erp_connection() returns jsonb
language sql security invoker set search_path = '' as $$
  select to_jsonb(s) - 'app_secret_id' - 'worker_secret_id' || jsonb_build_object('app_secret', v.decrypted_secret)
  from public.erp_connection_settings s join vault.decrypted_secrets v on v.id = s.app_secret_id
  where s.singleton;
$$;

create function public.save_erp_connection(
  p_name text, p_app_id text, p_app_secret text, p_warehouse_ids text[],
  p_sku_map jsonb, p_enabled boolean, p_sync_interval integer,
  p_worker_url text, p_revision integer, p_updated_by uuid
) returns integer language plpgsql security invoker set search_path = '' as $$
declare v_current public.erp_connection_settings; v_secret_id uuid; v_worker_id uuid; v_revision integer;
begin
  perform pg_advisory_xact_lock(741850202);
  select * into v_current from public.erp_connection_settings where singleton for update;
  if coalesce(v_current.revision, 0) <> p_revision then raise exception using errcode = '40001', message = 'ERP settings changed. Refresh and try again.'; end if;
  if length(btrim(p_name)) not between 1 and 100 or octet_length(p_app_id) not in (16,24,32) then raise exception 'Invalid ERP connection details'; end if;
  if jsonb_typeof(p_sku_map) is distinct from 'object' then raise exception 'Invalid SKU mappings'; end if;
  if p_enabled and p_sync_interval > 0 and (p_worker_url is null or p_worker_url !~ '^https://([a-zA-Z0-9][a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}/api/cron/inventory$') then raise exception 'Automatic sync requires a public HTTPS CRM URL'; end if;
  v_secret_id := v_current.app_secret_id;
  if nullif(btrim(p_app_secret), '') is not null then
    if v_secret_id is null then v_secret_id := vault.create_secret(p_app_secret, null, 'Filazoo Lingxing API credential');
    else perform vault.update_secret(v_secret_id, p_app_secret); end if;
  elsif v_secret_id is null or v_current.app_id <> p_app_id then raise exception 'App Secret is required for a new App ID';
  end if;
  v_worker_id := v_current.worker_secret_id;
  if v_worker_id is null then v_worker_id := vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), null, 'Filazoo inventory scheduler credential'); end if;
  v_revision := coalesce(v_current.revision, 0) + 1;
  insert into public.erp_connection_settings(singleton,name,app_id,app_secret_id,worker_secret_id,warehouse_ids,sku_map,enabled,sync_interval,worker_url,revision,updated_by)
    values(true,p_name,p_app_id,v_secret_id,v_worker_id,p_warehouse_ids,p_sku_map,p_enabled,p_sync_interval,p_worker_url,v_revision,p_updated_by)
    on conflict(singleton) do update set name=excluded.name,app_id=excluded.app_id,app_secret_id=excluded.app_secret_id,
      warehouse_ids=excluded.warehouse_ids,sku_map=excluded.sku_map,enabled=excluded.enabled,sync_interval=excluded.sync_interval,
      worker_url=excluded.worker_url,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=now(),
      last_dispatched_at=null,last_dispatch_id=null,last_dispatch_error=null;
  return v_revision;
end;
$$;

create function public.erp_worker_authorized(p_secret text) returns boolean
language sql security invoker set search_path = '' as $$
  select exists(select 1 from public.erp_connection_settings s join vault.decrypted_secrets v on v.id=s.worker_secret_id
    where s.singleton and s.enabled and extensions.digest(p_secret,'sha256') = extensions.digest(v.decrypted_secret,'sha256'));
$$;

create function public.dispatch_erp_inventory_sync() returns bigint
language plpgsql security invoker set search_path = '' as $$
declare v_settings public.erp_connection_settings; v_secret text; v_id bigint;
begin
  if not pg_try_advisory_xact_lock(741850203) then return null; end if;
  select * into v_settings from public.erp_connection_settings where singleton and enabled and sync_interval > 0
    and (last_dispatched_at is null or last_dispatched_at <= now() - make_interval(mins => sync_interval)) for update;
  if not found then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where id=v_settings.worker_secret_id;
  if v_secret is null then raise exception 'Inventory worker credential unavailable'; end if;
  v_id := net.http_get(url := v_settings.worker_url, headers := jsonb_build_object('Authorization','Bearer '||v_secret), timeout_milliseconds := 290000);
  update public.erp_connection_settings set last_dispatched_at=now(),last_dispatch_id=v_id,last_dispatch_error=null where singleton;
  return v_id;
exception when others then
  update public.erp_connection_settings set last_dispatch_error='Automatic stock sync could not be requested. Check the deployed CRM address.' where singleton;
  return null;
end;
$$;

revoke all on function public.read_erp_connection(), public.save_erp_connection(text,text,text,text[],jsonb,boolean,integer,text,integer,uuid), public.erp_worker_authorized(text), public.dispatch_erp_inventory_sync() from public, anon, authenticated;
grant execute on function public.read_erp_connection(), public.save_erp_connection(text,text,text,text[],jsonb,boolean,integer,text,integer,uuid), public.erp_worker_authorized(text), public.dispatch_erp_inventory_sync() to service_role;

-- This tick is idle until an administrator saves an enabled automatic
-- connection. Cron runs as its migration owner; no service-role elevation.
select cron.schedule('filazoo-erp-inventory-tick','*/5 * * * *','select public.dispatch_erp_inventory_sync();');

-- Conversation opt-in. All reads/writes go through authenticated server services.
create table public.email_auto_replies (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.workspace_mailboxes(id) on delete cascade,
  sender_id uuid not null references public.workspace_mailboxes(id) on delete cascade check(sender_id=mailbox_id),
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_to uuid not null references auth.users(id) on delete cascade,
  root_message_id text not null, thread_key text not null, recipient text not null,
  anchors text[] not null, history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  enabled boolean not null default false,
  status text not null default 'paused' check (status in ('active','paused','processing','waiting_shipping','ready','needs_review')),
  revision integer not null default 1,
  enabled_at timestamptz not null default now(), last_message_key text not null,
  pending_message_key text, pending_document jsonb, invoice_id uuid references public.invoices(id) on delete set null,
  task_id uuid references public.crm_tasks(id) on delete set null,
  last_error text, last_sent_at timestamptz, processing_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(mailbox_id, root_message_id)
);
create index email_auto_replies_due_idx on public.email_auto_replies(updated_at) where enabled;
create index email_auto_replies_anchors_idx on public.email_auto_replies using gin(anchors);
create index email_auto_replies_user_idx on public.email_auto_replies(user_id);
create index email_auto_replies_sender_idx on public.email_auto_replies(sender_id);
create index email_auto_replies_assignee_idx on public.email_auto_replies(assigned_to);
create index email_auto_replies_invoice_idx on public.email_auto_replies(invoice_id);
create index email_auto_replies_task_idx on public.email_auto_replies(task_id);
create trigger email_auto_replies_updated before update on public.email_auto_replies for each row execute function public.set_updated_at();

-- A durable reservation is written BEFORE SMTP. Interrupted or ambiguous sends
-- require human review and are never retried automatically.
create table public.email_auto_reply_deliveries (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.email_auto_replies(id) on delete cascade,
  message_key text not null, status text not null check (status in ('reserved','sent','failed')),
  message_id text, error text, created_at timestamptz not null default now(), sent_at timestamptz,
  unique(automation_id, message_key)
);
create table public.email_reply_knowledge (
  id uuid primary key default gen_random_uuid(), title text not null check(char_length(title) between 1 and 200),
  content text not null check(char_length(content) between 1 and 10000),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
create index email_reply_knowledge_creator_idx on public.email_reply_knowledge(created_by);
alter table public.email_auto_replies enable row level security;
alter table public.email_auto_reply_deliveries enable row level security;
alter table public.email_reply_knowledge enable row level security;
revoke all on public.email_auto_replies, public.email_auto_reply_deliveries, public.email_reply_knowledge from public, anon, authenticated;
grant select, insert, update, delete on public.email_auto_replies, public.email_auto_reply_deliveries, public.email_reply_knowledge to service_role;

-- Save the pause, task and notification together, including revision protection
-- against a user stopping AI while generation was running.
create function public.handoff_email_auto_reply(
  p_id uuid, p_revision integer, p_status text, p_document jsonb, p_message_key text,
  p_history jsonb, p_reason text, p_company_id uuid default null, p_contact_id uuid default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare a public.email_auto_replies; v_task uuid;
begin
  select * into a from public.email_auto_replies where id=p_id for update;
  if a.id is null or not a.enabled or a.revision <> p_revision or a.status <> 'processing' then
    raise exception 'Automation changed or was stopped';
  end if;
  if p_status not in ('waiting_shipping','needs_review') then raise exception 'Invalid handoff'; end if;
  v_task := coalesce(a.task_id, gen_random_uuid());
  insert into public.crm_tasks(id,company_id,contact_id,assigned_to,title,notes,priority,status,due_at)
    values(v_task,p_company_id,p_contact_id,a.assigned_to,
      case when p_status='waiting_shipping' then 'Add shipping cost to send customer invoice' else 'Review AI email reply' end,
      left(p_reason,4000) || E'\nOpen conversation: /emails?mailbox=' || a.mailbox_id::text || '&thread=' || a.thread_key,
      'high','open',now())
    on conflict(id) do update set title=excluded.title,notes=excluded.notes,status='open',completed_at=null,assigned_to=excluded.assigned_to;
  insert into public.internal_notifications(user_id,message,conversation_id,include_thread_link)
    values(a.assigned_to,left(case when p_status='waiting_shipping' then 'Shipping approval required: ' else 'AI reply needs review: ' end || a.recipient || '. ' || p_reason,500),a.thread_key,true);
  update public.email_auto_replies set status=p_status,pending_document=p_document,pending_message_key=p_message_key,
    history=p_history,task_id=v_task,last_error=p_reason,processing_at=null where id=p_id;
end;
$$;
revoke all on function public.handoff_email_auto_reply(uuid,integer,text,jsonb,text,jsonb,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.handoff_email_auto_reply(uuid,integer,text,jsonb,text,jsonb,text,uuid,uuid) to service_role;


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

-- Task and notification lifecycle (2026-10-29).
begin;

alter table public.crm_tasks add column follows_company_owner boolean not null default false;
alter table public.internal_notifications
  add column task_id uuid references public.crm_tasks(id) on delete cascade,
  add column event_key text unique,
  add column is_unread boolean generated always as (read_at is null) stored;
create index internal_notifications_task_idx on public.internal_notifications(task_id) where task_id is not null;
create index internal_notifications_inbox_idx on public.internal_notifications(user_id,is_unread desc,created_at desc,id);
create index crm_tasks_due_reminder_idx on public.crm_tasks(due_at,id) where status='open' and assigned_to is not null;

update public.crm_tasks set follows_company_owner=true
where notes='Scheduled from intelligent next follow-up recommendation.' or notes like 'Company purchase analysis: %';

-- Every producer (CRM, flows, AI and product analysis) shares the same lifecycle.
create function public.sync_crm_task_activity() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
  assigned boolean := false;
  marker constant text := 'Scheduled from intelligent next follow-up recommendation.';
begin
  if tg_op='INSERT' then
    assigned := new.status='open' and new.assigned_to is not null;
  else
    -- Retire obsolete reminders; history remains visible as read.
    if new.status<>'open' or new.assigned_to is distinct from old.assigned_to then
      update public.internal_notifications set read_at=coalesce(read_at,now())
      where task_id=new.id and read_at is null;
    elsif new.due_at is distinct from old.due_at then
      update public.internal_notifications set read_at=coalesce(read_at,now())
      where task_id=new.id and event_key like 'task-due:%' and read_at is null;
    end if;
    assigned := new.status='open' and new.assigned_to is not null
      and (old.status<>'open' or new.assigned_to is distinct from old.assigned_to);

    -- Only the currently scheduled reminder may change the company's date.
    -- The pipeline trigger sees the same date and cannot recreate a closed task.
    if old.notes=marker and old.status='open' and new.company_id is not null then
      if new.status<>'open' then
        update public.pipeline set next_followup_at=null
        where company_id=new.company_id and next_followup_at=old.due_at
          and not exists(select 1 from public.crm_tasks t where t.company_id=new.company_id and t.id<>new.id and t.status='open' and t.notes=marker);
      elsif new.due_at is distinct from old.due_at then
        update public.pipeline set next_followup_at=new.due_at
        where company_id=new.company_id and next_followup_at=old.due_at;
      end if;
    end if;
  end if;
  if assigned and exists(select 1 from public.workspace_members where user_id=new.assigned_to and activated_at is not null) then
    insert into public.internal_notifications(user_id,message,task_id,include_thread_link)
    values(new.assigned_to,left('Task assigned: '||new.title,500),new.id,false);
  end if;
  return new;
end;
$$;
revoke all on function public.sync_crm_task_activity() from public,anon,authenticated;
grant execute on function public.sync_crm_task_activity() to service_role;
create trigger crm_tasks_activity after insert or update of status,due_at,assigned_to on public.crm_tasks
for each row execute function public.sync_crm_task_activity();

create function public.transfer_company_followup_tasks() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.owner_id is distinct from old.owner_id then
    update public.crm_tasks set assigned_to=new.owner_id
    where company_id=new.company_id and status='open'
      and (follows_company_owner or notes='Scheduled from intelligent next follow-up recommendation.' or notes like 'Company purchase analysis: %')
      and assigned_to is distinct from new.owner_id;
  end if;
  return new;
end;
$$;
revoke all on function public.transfer_company_followup_tasks() from public,anon,authenticated;
grant execute on function public.transfer_company_followup_tasks() to service_role;
create trigger pipeline_transfer_followup_tasks after update of owner_id on public.pipeline
for each row execute function public.transfer_company_followup_tasks();

-- Link AI handoff alerts to their task so resolving or stopping the handoff
-- clears its unread alert and opens the correct review controls from history.
create or replace function public.handoff_email_auto_reply(
  p_id uuid, p_revision integer, p_status text, p_document jsonb, p_message_key text,
  p_history jsonb, p_reason text, p_company_id uuid default null, p_contact_id uuid default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare a public.email_auto_replies; v_task uuid;
begin
  select * into a from public.email_auto_replies where id=p_id for update;
  if a.id is null or not a.enabled or a.revision <> p_revision or a.status <> 'processing' then
    raise exception 'Automation changed or was stopped';
  end if;
  if p_status not in ('waiting_shipping','needs_review') then raise exception 'Invalid handoff'; end if;
  v_task := coalesce(a.task_id, gen_random_uuid());
  insert into public.crm_tasks(id,company_id,contact_id,assigned_to,title,notes,priority,status,due_at)
    values(v_task,p_company_id,p_contact_id,a.assigned_to,
      case when p_status='waiting_shipping' then 'Add shipping cost to send customer invoice' else 'Review AI email reply' end,
      left(p_reason,4000) || E'\nOpen conversation: /emails?mailbox=' || a.mailbox_id::text || '&thread=' || a.thread_key,
      'high','open',now())
    on conflict(id) do update set title=excluded.title,notes=excluded.notes,status='open',completed_at=null,assigned_to=excluded.assigned_to;
  insert into public.internal_notifications(user_id,message,conversation_id,include_thread_link,task_id,event_key)
    values(a.assigned_to,left(case when p_status='waiting_shipping' then 'Shipping approval required: ' else 'AI reply needs review: ' end || a.recipient || '. ' || p_reason,500),a.thread_key,true,v_task,'auto-reply-handoff:'||a.id||':'||p_revision)
    on conflict(event_key) do nothing;
  update public.email_auto_replies set status=p_status,pending_document=p_document,pending_message_key=p_message_key,
    history=p_history,task_id=v_task,last_error=p_reason,processing_at=null where id=p_id;
end;
$$;
revoke all on function public.handoff_email_auto_reply(uuid,integer,text,jsonb,text,jsonb,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.handoff_email_auto_reply(uuid,integer,text,jsonb,text,jsonb,text,uuid,uuid) to service_role;

-- A task due at the same instant is notified once per recipient, even when
-- multiple schedulers run. Row locks serialize completion and notification.
create function public.notify_due_crm_tasks() returns integer
language plpgsql security invoker set search_path='' as $$
declare
  task record;
  inserted integer;
  total integer := 0;
begin
  for task in
    select t.id,t.title,t.assigned_to,t.due_at,
      'task-due:'||t.id||':'||t.assigned_to||':'||extract(epoch from t.due_at) as reminder_key
    from public.crm_tasks t join public.workspace_members m on m.user_id=t.assigned_to and m.activated_at is not null
    where t.status='open' and t.due_at<=now()
      and not exists(select 1 from public.internal_notifications n where n.event_key='task-due:'||t.id||':'||t.assigned_to||':'||extract(epoch from t.due_at))
    order by t.due_at,t.id limit 500 for update of t skip locked
  loop
    insert into public.internal_notifications(user_id,message,task_id,event_key,include_thread_link)
    values(task.assigned_to,left('Task due: '||task.title,500),task.id,task.reminder_key,false)
    on conflict(event_key) do nothing;
    get diagnostics inserted = row_count;
    total := total+inserted;
  end loop;
  return total;
end;
$$;
revoke all on function public.notify_due_crm_tasks() from public,anon,authenticated;
grant execute on function public.notify_due_crm_tasks() to service_role;

create extension if not exists pg_cron;
select cron.schedule('filazoo-task-due-reminders','* * * * *','select public.notify_due_crm_tasks();');
notify pgrst,'reload schema';
commit;
