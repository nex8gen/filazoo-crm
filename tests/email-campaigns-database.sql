-- All changes are rolled back; the worker cannot see the test reservations.
begin;
do $$
declare
  campaign uuid := gen_random_uuid();
  actor uuid;
  stamp timestamptz;
  dispatch jsonb;
  operations jsonb;
  outcome jsonb;
begin
  select owner_id into actor from public.workspaces where id = crm_tenancy.workspace_id();
  insert into public.marketing_assets(id,category,slot,year,title,start_date,end_date,created_by,updated_by,campaign_config)
    values(campaign,'factory_sale',campaign::text,2026,'Campaign verification (rolled back)','2026-11-12','2026-11-12',actor,actor,'{"channel":"email","type":"single"}') returning updated_at into stamp;
  dispatch := jsonb_build_object('queuedAt',now(),'scheduledAt','2050-01-01T00:00:00Z','recipientCount',1,'userId',actor);
  operations := jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'hash',repeat('0',64),'payload',jsonb_build_object('to',jsonb_build_array('not-sent@example.test'),'text','Test only'),'scheduledAt','2050-01-01T00:00:00Z'));
  begin
    perform public.queue_marketing_campaign(campaign,stamp - interval '1 second',actor,operations,dispatch);
    raise exception 'Stale campaign was unexpectedly queued';
  exception when raise_exception then
    if sqlerrm <> 'Campaign changed. Reload before sending.' then raise; end if;
  end;
  outcome := public.queue_marketing_campaign(campaign,stamp,actor,operations,dispatch);
  if outcome <> dispatch then raise exception 'Dispatch not persisted'; end if;
  outcome := public.queue_marketing_campaign(campaign,stamp,actor,operations,dispatch);
  if (select count(*) from public.email_send_operations where campaign_id=campaign) <> 1 then raise exception 'Repeat submission duplicated delivery'; end if;
  if not exists(select 1 from public.marketing_assets saved where saved.id=campaign and saved.dispatch=outcome) then raise exception 'Dispatch missing'; end if;
  if has_function_privilege('anon','public.queue_marketing_campaign(uuid,timestamptz,uuid,jsonb,jsonb)','EXECUTE') then raise exception 'Anonymous submission is exposed'; end if;
end;
$$;
rollback;
