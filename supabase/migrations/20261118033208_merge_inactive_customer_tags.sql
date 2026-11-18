begin;

-- Keep assignment identity, ownership, source and timestamps intact. This is a
-- vocabulary merge, not new customer activity or a fresh manual/AI decision.
alter table public.crm_email_tags drop constraint crm_email_tags_tag_check;
update public.crm_email_tags
  set tag = 'Inactive Customers'
  where tag in ('Long-term Inactive Customers', 'Postponed Purchasing');
update public.crm_conversation_tag_analysis
  set tag = 'Inactive Customers'
  where tag in ('Long-term Inactive Customers', 'Postponed Purchasing');

alter table public.crm_email_tags add constraint crm_email_tags_tag_check check (tag in (
  'Prospect Nurturing', 'New Inquiries', 'Quotation Follow-up', 'Active Negotiations',
  'Payment Follow-up', 'Orders in Fulfillment', 'Repeat Customers', 'Inactive Customers'
));

-- Saved automation criteria must use the same vocabulary as the editor/runtime.
-- Only exact JSON string values change; surrounding prose is preserved.
update public.flows set trigger_config = replace(replace(trigger_config::text,
  '"Long-term Inactive Customers"', '"Inactive Customers"'),
  '"Postponed Purchasing"', '"Inactive Customers"')::jsonb
  where trigger_config::text ~ '"(Long-term Inactive Customers|Postponed Purchasing)"';
update public.flow_steps set config = replace(replace(config::text,
  '"Long-term Inactive Customers"', '"Inactive Customers"'),
  '"Postponed Purchasing"', '"Inactive Customers"')::jsonb
  where config::text ~ '"(Long-term Inactive Customers|Postponed Purchasing)"';
update public.flow_editor_drafts set payload = replace(replace(payload::text,
  '"Long-term Inactive Customers"', '"Inactive Customers"'),
  '"Postponed Purchasing"', '"Inactive Customers"')::jsonb
  where payload::text ~ '"(Long-term Inactive Customers|Postponed Purchasing)"';
update public.company_segments set rules = replace(replace(rules::text,
  '"Long-term Inactive Customers"', '"Inactive Customers"'),
  '"Postponed Purchasing"', '"Inactive Customers"')::jsonb
  where rules::text ~ '"(Long-term Inactive Customers|Postponed Purchasing)"';

-- In-flight runs store a frozen step definition as a JSON-encoded string.
update public.flow_runs set context = jsonb_set(context, '{definition}',
  to_jsonb(replace(replace(context->>'definition',
    '"Long-term Inactive Customers"', '"Inactive Customers"'),
    '"Postponed Purchasing"', '"Inactive Customers"')))
  where jsonb_typeof(context->'definition') = 'string'
    and context->>'definition' ~ '"(Long-term Inactive Customers|Postponed Purchasing)"';
update public.flow_runs set context = replace(replace(context::text,
  '"Long-term Inactive Customers"', '"Inactive Customers"'),
  '"Postponed Purchasing"', '"Inactive Customers"')::jsonb
  where context::text ~ '"(Long-term Inactive Customers|Postponed Purchasing)"';

notify pgrst, 'reload schema';
commit;
