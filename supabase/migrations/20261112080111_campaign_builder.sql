alter table public.marketing_assets
  add column campaign_config jsonb,
  add column dispatch jsonb,
  add constraint marketing_campaign_config_object check (campaign_config is null or jsonb_typeof(campaign_config) = 'object'),
  add constraint marketing_campaign_dispatch_object check (dispatch is null or jsonb_typeof(dispatch) = 'object');

alter table public.email_send_operations add column campaign_id uuid;
alter table public.email_send_operations add constraint email_send_campaign_fk
  foreign key (workspace_id,campaign_id) references public.marketing_assets(workspace_id,id) on delete restrict;
create index email_send_campaign_status on public.email_send_operations(workspace_id,campaign_id,status) where campaign_id is not null;

-- Serialize submission per campaign and reserve the entire audience atomically.
create function public.queue_marketing_campaign(
  p_campaign_id uuid, p_expected_updated_at timestamptz, p_user_id uuid,
  p_operations jsonb, p_dispatch jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  plan public.marketing_assets%rowtype;
begin
  select * into plan from public.marketing_assets
    where workspace_id = crm_tenancy.workspace_id() and id = p_campaign_id for update;
  if not found then raise exception 'Campaign not found'; end if;
  if plan.dispatch is not null then return plan.dispatch; end if;
  if plan.updated_at <> p_expected_updated_at then raise exception 'Campaign changed. Reload before sending.'; end if;
  if jsonb_typeof(p_operations) <> 'array' or jsonb_array_length(p_operations) not between 1 and 5000 then
    raise exception 'Choose between 1 and 5000 recipients';
  end if;
  if p_user_id <> (p_dispatch->>'userId')::uuid or (p_dispatch->>'recipientCount')::integer <> jsonb_array_length(p_operations) then
    raise exception 'Invalid campaign submission';
  end if;
  insert into public.email_send_operations(workspace_id,user_id,id,campaign_id,request_hash,payload,status,scheduled_at)
    select plan.workspace_id,p_user_id,(item->>'id')::uuid,plan.id,item->>'hash',item->'payload','scheduled',(item->>'scheduledAt')::timestamptz
    from jsonb_array_elements(p_operations) item;
  update public.marketing_assets set dispatch = p_dispatch, updated_at = clock_timestamp(), updated_by = p_user_id
    where workspace_id = plan.workspace_id and id = plan.id;
  return p_dispatch;
end;
$$;
revoke all on function public.queue_marketing_campaign(uuid,timestamptz,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.queue_marketing_campaign(uuid,timestamptz,uuid,jsonb,jsonb) to crm_workspace_server,service_role;
notify pgrst,'reload schema';
