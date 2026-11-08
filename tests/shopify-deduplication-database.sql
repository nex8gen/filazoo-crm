-- Rollback-only fixtures. Claiming never writes CRM customers or enrolls flows.
begin;
do $$
declare
  fixture jsonb := jsonb_build_object(
    'webhook_id', 'dedup-regression:' || gen_random_uuid(),
    'shop_domain', 'dedup-regression.example.test',
    'customer_id', 'form:dedup-regression',
    'email', 'dedup-regression@example.test', 'company_name', 'Dedup regression',
    'tags', '[]'::jsonb, 'created_at', now(),
    'raw_payload', '{"contact[email]":"dedup-regression@example.test","contact[body]":"Price please","submission_id":"one","h-captcha-response":"token-one"}'::jsonb
  );
  next_fixture jsonb;
  result jsonb;
begin
  result := public.claim_shopify_lead(fixture);
  assert (result->>'claimed')::boolean, 'First submission must be claimed';
  result := public.claim_shopify_lead(fixture);
  assert result->>'status' = 'processing' and not (result->>'claimed')::boolean, 'Same ID cannot race';

  next_fixture := fixture || jsonb_build_object('webhook_id', 'dedup-regression:' || gen_random_uuid(),
    'raw_payload', (fixture->'raw_payload') || '{"submission_id":"two","h-captcha-response":"token-two","form_key":"different","_crm_location":{"country":"US"}}'::jsonb);
  result := public.claim_shopify_lead(next_fixture);
  assert result->>'status' = 'processing' and not (result->>'claimed')::boolean, 'Different ID and CAPTCHA cannot race';

  update public.shopify_leads set status = 'failed' where webhook_id = fixture->>'webhook_id';
  result := public.claim_shopify_lead(fixture);
  assert (result->>'claimed')::boolean, 'Failed submission must be retryable';

  update public.shopify_leads set status = 'processed' where webhook_id = fixture->>'webhook_id';
  result := public.claim_shopify_lead(next_fixture);
  assert result->>'status' = 'processed' and not (result->>'claimed')::boolean, 'Identical completed enquiry must be deduplicated';

  next_fixture := next_fixture || jsonb_build_object('raw_payload', (fixture->'raw_payload') || '{"contact[body]":"A changed request"}'::jsonb);
  result := public.claim_shopify_lead(next_fixture);
  assert (result->>'claimed')::boolean, 'Changed enquiry must be retained';
  update public.shopify_leads set status = 'processed', created_at = now() - interval '11 minutes'
    where shop_domain = 'dedup-regression.example.test';
  next_fixture := fixture || jsonb_build_object('webhook_id', 'dedup-regression:' || gen_random_uuid());
  result := public.claim_shopify_lead(next_fixture);
  assert (result->>'claimed')::boolean, 'Identical later follow-up must be retained';

  assert public.shopify_form_content('{"contact[email]":" BUYER@EXAMPLE.TEST ","contact[body]":" Hi ","contact[Phone]":"","form_key":"x"}'::jsonb)
    = '{"contact[email]":"buyer@example.test","contact[body]":"Hi"}'::jsonb, 'Only nonempty submitted contact fields are compared';
end;
$$;
rollback;
