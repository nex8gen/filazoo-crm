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
begin
  if not exists(select 1 from public.workspace_members where user_id = p_actor and activated_at is not null and role in ('admin','operator')) then
    raise exception 'Billing access denied.';
  end if;
  select * into inv from public.invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found.'; end if;
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
