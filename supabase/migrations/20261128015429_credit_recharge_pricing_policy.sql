-- Explicitly document the only allowed role; browser and tenant roles retain
-- neither table privileges nor a policy granting access to pricing snapshots.
create policy credit_recharge_pricing_service on crm_billing.credit_recharge_pricing
 for all to service_role using(true) with check(true);
