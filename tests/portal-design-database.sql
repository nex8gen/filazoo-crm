-- Rollback-only checks: synthetic tenants and memberships; no messages or emails.
begin;
do $$
declare actor uuid; tenant_a uuid := gen_random_uuid(); tenant_b uuid := gen_random_uuid(); n integer;
begin
  select user_id into actor from public.workspace_members where role='admin' and activated_at is not null limit 1;
  if actor is null then raise exception 'Test requires an existing workspace admin'; end if;
  insert into public.workspaces(id,name,slug) values
    (tenant_a,'Portal verification A','portal-test-'||tenant_a), (tenant_b,'Portal verification B','portal-test-'||tenant_b);
  insert into public.workspace_members(workspace_id,user_id,role,activated_at) values
    (tenant_a,actor,'admin',now()), (tenant_b,actor,'viewer',now());
  perform set_config('crm.workspace_id',tenant_a::text,true);
  perform set_config('request.headers',jsonb_build_object('x-crm-user-id',actor)::text,true);
  perform set_config('role','crm_workspace_server',true);
  insert into public.workspace_portal_designs(draft) values('{"test":"draft"}');
  update public.workspace_portal_designs set published=draft,published_at=now(),revision=2 where singleton and revision=1;
  update public.workspace_portal_designs set draft='{"test":"new draft"}',revision=3 where singleton and revision=2;
  if not exists(select 1 from public.workspace_portal_designs where published->>'test'='draft' and draft->>'test'='new draft') then
    raise exception 'Saving a draft changed the published portal'; end if;
  update public.workspace_portal_designs set revision=99 where singleton and revision=2;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Stale revision overwrote newer changes'; end if;
  -- Multiple draft themes share one atomic revision while the live snapshot stays intact.
  update public.workspace_portal_designs set themes='[{"id":"one","design":{"heading":"First"}},{"id":"two","design":{"heading":"Second"}}]',live_theme_id='one',revision=4 where singleton and revision=3;
  update public.workspace_portal_designs set themes=jsonb_set(themes,'{1,design,heading}','"Changed second draft"'),revision=5 where singleton and revision=4;
  if not exists(select 1 from public.workspace_portal_designs where published->>'test'='draft' and themes->0->'design'->>'heading'='First' and themes->1->'design'->>'heading'='Changed second draft') then
    raise exception 'Editing a library theme affected another draft or the live portal'; end if;
  -- No actor: customer sessions can read their design, but cannot modify it.
  perform set_config('request.headers','{}',true);
  if (select count(*) from public.workspace_portal_designs)<>1 then raise exception 'Customer-scoped design read failed'; end if;
  update public.workspace_portal_designs set draft='{}' where singleton;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Customer updated a portal'; end if;
  -- Different tenant and non-admin membership: no reads or writes across tenants.
  perform set_config('crm.workspace_id',tenant_b::text,true);
  perform set_config('request.headers',jsonb_build_object('x-crm-user-id',actor)::text,true);
  if exists(select 1 from public.workspace_portal_designs) then raise exception 'Cross-workspace design leak'; end if;
  begin
    insert into public.workspace_portal_designs(draft) values('{}');
    raise exception 'Viewer created a portal design';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.workspace_portal_designs(workspace_id,draft) values(tenant_a,'{}');
    raise exception 'Cross-workspace design write accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.workspace_portal_designs;
    raise exception 'Anonymous design access accepted';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
