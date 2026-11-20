-- Explicitly document the sole permitted database role; browsers have no grants.
create policy billing_service_only on public.workspace_subscriptions for all to service_role using (true) with check (true);
create policy billing_service_only on public.subscription_orders for all to service_role using (true) with check (true);

create or replace function public.confirm_subscription_payment(p_out_trade_no text,p_trade_no text,p_amount_fen integer,p_status text)
returns uuid language plpgsql set search_path='' as $$
declare o public.subscription_orders; start_at timestamptz; seats integer;
begin
  select * into o from public.subscription_orders where out_trade_no=p_out_trade_no for update;
  if not found then raise exception 'Unknown order'; end if;
  if o.amount_fen is distinct from p_amount_fen or p_trade_no !~ '^[0-9]{16,64}$' or p_trade_no is null then raise exception 'Payment details do not match'; end if;
  if o.alipay_trade_no is not null and o.alipay_trade_no<>p_trade_no then raise exception 'Transaction mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(o.workspace_id::text,1));
  if p_status='TRADE_CLOSED' then
    update public.subscription_orders set status=case when status='paid' then 'refunded' when status='refunded' then 'refunded' else 'closed' end,alipay_trade_no=p_trade_no where id=o.id;
    return o.id;
  end if;
  if p_status not in ('TRADE_SUCCESS','TRADE_FINISHED') or p_status is null then raise exception 'Payment is not completed'; end if;
  if o.status='paid' then return o.id; end if;
  if o.status<>'pending' then raise exception 'Order is no longer payable'; end if;
  select greatest(now(),coalesce(max(period_end),now())) into start_at from public.subscription_orders where workspace_id=o.workspace_id and status='paid';
  seats := case o.plan_id when 'starter' then 1 else 5 end;
  if (select count(*) from public.workspace_members where workspace_id=o.workspace_id)>seats then raise exception 'Team exceeds plan capacity'; end if;
  update public.subscription_orders set status='paid',alipay_trade_no=p_trade_no,paid_at=now(),period_start=start_at,period_end=start_at+interval '1 month' where id=o.id;
  return o.id;
end $$;
notify pgrst,'reload schema';
