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
  join auth.users account on account.id = member.user_id
  where member.role = 'bd_manager' and member.auto_assign_leads = true and account.email_confirmed_at is not null
  order by member.last_lead_assigned_at asc nulls first, member.created_at asc, member.user_id asc limit 1 for update;
  if selected_user_id is not null then
    update public.workspace_members set last_lead_assigned_at = clock_timestamp() where user_id = selected_user_id;
  end if;
  return selected_user_id;
end;
$$;
revoke all on function public.claim_next_bd_sales_manager() from public, anon, authenticated;
grant execute on function public.claim_next_bd_sales_manager() to service_role;

commit;
