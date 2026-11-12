-- Private workspace library. Binary objects are accessed only through short-lived
-- signed URLs issued after the CRM's live workspace membership check.
create table public.document_folders (
  workspace_id uuid not null default crm_tenancy.workspace_id() references public.workspaces(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  color text not null default 'green' check (color in ('green','blue','amber','purple')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (workspace_id,id),
  unique (workspace_id,name)
);
create table public.library_documents (
  workspace_id uuid not null default crm_tenancy.workspace_id() references public.workspaces(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  kind text not null check (kind in ('file','template')),
  name text not null check (length(trim(name)) between 1 and 200),
  mime_type text not null default 'application/octet-stream',
  size bigint not null default 0 check (size between 0 and 52428800),
  object_path text,
  folder_id uuid,
  company text not null default '' check (length(company) <= 160),
  tags text[] not null default '{}' check (cardinality(tags) <= 12),
  description text not null default '' check (length(description) <= 2000),
  subject text not null default '' check (length(subject) <= 300),
  body text not null default '' check (length(body) <= 12000),
  search_text text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (workspace_id,id),
  foreign key (workspace_id,folder_id) references public.document_folders(workspace_id,id) on delete restrict,
  check ((kind='file' and object_path is not null and size > 0) or (kind='template' and object_path is null and length(trim(body)) > 0)),
  check (object_path is null or object_path=workspace_id::text || '/' || id::text)
);
create table public.document_stars (
  workspace_id uuid not null default crm_tenancy.workspace_id() references public.workspaces(id) on delete restrict,
  document_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (workspace_id,document_id,user_id),
  foreign key (workspace_id,document_id) references public.library_documents(workspace_id,id) on delete cascade
);
create index document_folders_creator on public.document_folders(created_by);
create index library_documents_creator on public.library_documents(created_by);
create index library_documents_recent on public.library_documents(workspace_id,updated_at desc,id);
create index library_documents_folder on public.library_documents(workspace_id,folder_id);
create index document_stars_user on public.document_stars(user_id,workspace_id);

alter table public.document_folders enable row level security;
alter table public.library_documents enable row level security;
alter table public.document_stars enable row level security;
revoke all on public.document_folders,public.library_documents,public.document_stars from anon,authenticated;
grant select,insert,update,delete on public.document_folders,public.library_documents,public.document_stars to crm_workspace_server,service_role;
create policy crm_workspace_isolation on public.document_folders to crm_workspace_server
  using (workspace_id=(select crm_tenancy.workspace_id())) with check (workspace_id=(select crm_tenancy.workspace_id()));
create policy crm_workspace_isolation on public.library_documents to crm_workspace_server
  using (workspace_id=(select crm_tenancy.workspace_id())) with check (workspace_id=(select crm_tenancy.workspace_id()));
create policy crm_workspace_isolation on public.document_stars to crm_workspace_server
  using (workspace_id=(select crm_tenancy.workspace_id())) with check (workspace_id=(select crm_tenancy.workspace_id()));

insert into storage.buckets(id,name,public,file_size_limit)
values ('workspace-documents','workspace-documents',false,52428800);
notify pgrst,'reload schema';
