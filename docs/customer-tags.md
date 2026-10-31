# Shared customer tags

The ten names, business meanings, and colors are defined once in `lib/customer-tags.ts`. Display names have no numeric prefixes. The inbox, company email reader, company list/profile, automation builder, and AI email organizer use this vocabulary. Shared rounded badges use soft backgrounds and a matching action icon in `components/customer-tag-badges.tsx`.

The company list prioritizes payment, fulfillment, and active sales follow-ups. It places the overlapping icon-only tags first, followed by the two priority tags with labels. Hovering or focusing an icon smoothly expands that tag while the others collapse; leaving restores the default preview. A permanent hidden preview sizes the row, while an absolutely positioned layer animates without changing table column widths. Icon padding stays constant so expansion starts from the same point. Its CSS respects both system and workspace reduced-motion settings. In the company header, multiple tags use icons only; the Profile form has no duplicate tag row.

Each email subject/conversation has one optional situation tag in `crm_email_tags`. Click the colored icon chip beside the subject to change or remove it from a menu of matching chips. Individual replies have no tag controls. Conversation keys and RFC reference aliases identify the same thread across CRM, sent-mail, and IMAP copies, so new replies retain the tag. A company displays every distinct tag across its linked conversations; another subject from the same company can have a different tag.

Legacy message assignments remain readable. Changing a conversation tag writes its thread aliases and clears the replaced message assignments in a single upsert, so company aggregation cannot retain superseded tags. Clearing a thread tag retains a null assignment to prevent older message tags from reappearing.

Read, star, folder, and reminder state remains personal in `email_inbox_state`. Those changes cannot overwrite shared tags. Reminder dates do not imply a quotation, order, or payment stage.

## Automatic conversation tagging

Successfully imported Shopify B2B leads and Meta lead forms start with **New Inquiries**, by an explicit intake rule. Database triggers set the tag after company linking / successful processing, in the same transaction, with `source = 'rule'`. No model, API key or enabled AI feature is needed for this default. Pending/failed Shopify imports are not tagged. Duplicate deliveries never overwrite an existing assignment, including manual removals. Existing historical leads are not reset by the migration.

The default belongs to that particular lead inquiry, not every future subject from its company. Shopify and Meta forms have stable conversation keys (`shopify:<webhook-id>` / `meta-lead:<lead-id>`). Meta forms with an email address appear as replyable CRM form inquiries; they are not fabricated SMTP messages. Later replies retain the explicit inquiry thread key and RFC reference chain, so updating the conversation replaces its initial tag rather than leaving an unrelated New Inquiries tag behind. The worker loads an original form only through that exact thread key and matching contact; it never guesses a link from a company name, subject, source label or nearby timestamps.

For subsequent messages, `lib/data/conversation-tagging.ts` reads each subject's saved conversation history and asks the configured AI provider to assess its current situation. This is semantic classification, not keyword matching or a fixed sequence. It rechecks when an inbound reply or a sent message changes that conversation. The inbox/company-email refresh and existing mail-sync/flow cron ticks run bounded batches; older conversations are gradually backfilled without requiring the browser to stay open on the deployed app.

AI uses the ten existing names and writes the same shared conversation aliases as the manual selector. Company tags therefore update from their conversations automatically. Settings → AI access & behavior → Automatically tag conversations controls this separately from sending or drafting. Automatic tagging also requires the master, email and automation switches plus email/customer data access. This workspace has tagging enabled; new workspaces default to review. Other action permissions keep their existing values.

`crm_conversation_tag_analysis` caches the input fingerprint, decision, confidence, reason and exact supporting quotes. Expiring database leases prevent duplicate provider calls. Repeated failures of the same input back off for 15 minutes, 1 hour, 6 hours, then 24 hours. New input resets this backoff, subject to a database-enforced one-minute cooldown per conversation. Unchanged conversations are not repeatedly billed for analysis. The worker checks the conversation again after the provider returns; the database rejects expired ownership, older partial snapshots and access revoked during analysis. Manual/flow edits win over an in-flight result and remain until new conversation activity. Removing a tag receives the same protection.

### Cost rules and their boundaries

| Condition | Result | AI calls |
| --- | --- | --- |
| Verified, successfully imported Shopify/Meta lead inquiry | Start as New Inquiries | 0 |
| Same intake event delivered again | Preserve the existing tag/removal | 0 |
| Read/star/preview/body-cache enrichment or an unsent provider draft | Reuse the prior analysis; drafts are excluded | 0 |
| Recent analysis followed by several rapid replies | Defer until the one-minute cooldown expires, then assess the latest complete thread | 0 during cooldown |
| Missing referenced messages, more than 64 messages, or empty subject/body | Preserve the tag without a model request; detectable header problems are checked before body downloads | 0 |
| Manual/flow tag newer than the conversation activity | Preserve the override | 0 |
| New substantive conversation activity requiring interpretation | Evidence-validated AI classification | Bounded by existing batch limits |

The fingerprint uses immutable email identities and normalized headers. Imported preview changes and UI flags do not invalidate it. Changed membership / reference history does, so loading missing messages still allows reassessment.

The classifier prompt removes duplicate tag descriptions and irrelevant writing/sending policy text while preserving business context and general workspace guidance. Repeated body strings are represented with exact references to earlier message bodies. Tests reconstruct the prompt and compare every character, speaker, subject and message order; no AI-written history summary or guessed quote stripping is used. Repetition across different speakers still creates a new message and needs interpretation. The synthetic repeated-history test reduces prompt characters by more than 45%; this is a fixture result, not a promise about tokens, invoices or every real conversation.

The response budget is 1,000 tokens (previously 1,600), with one short reason and at most two short evidence quotes. Lowering the cap alone does not guarantee lower billed output. `last_cost_metrics` stores the last attempt's rule/AI source, provider request count, prompt characters and provider-reported input/output/cache tokens when available. Reasoning tokens are included where reported separately by Gemini; Gateway completion tokens already include them. Missing usage is omitted rather than estimated. These are diagnostic counters, not a substitute for the provider's billing report, and requests lost before a fenced completion cannot be fully accounted for here.

No code rule infers Payment Follow-up from the word "paid", treats a filename as a sent quotation, maps all company orders onto every subject, or assumes that "OK" always means the same thing. Those shortcuts cannot guarantee the requested meaning. The guaranteed behavior is the explicit intake/default and preservation rules under their stated conditions; free-text AI decisions remain subject to evidence and confidence checks.

An accepted proposal requires at least 85% model confidence and verbatim evidence validated against the supplied messages. Low confidence, unrelated/system mail, missing or oversized history and provider failures keep the current tag. Referenced messages missing from the saved history also prevent replacement until sync fills the gap. The current bounded prompt covers up to 64 messages / 80,000 body characters, with no attachment contents. Inactivity tags require configured company-wide inactivity thresholds, which this email-only classifier does not guess. Repeat-customer/order/payment states require explicit evidence rather than mentions of a quote or invoice. Tag changes do not record payments, create orders or send messages.

Provider configuration reuses `GEMINI_API_KEY` / `GEMINI_EMAIL_MODEL`, with the existing AI Gateway fallback (`AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`). Local Vercel OIDC tokens expire; refresh them using `vercel env pull`, preserving local-only overrides. Deployed Vercel tokens are managed by the platform. No mailbox credentials are included in the model prompt.

Local verification on October 31, 2026: the provider smoke test reached Gemini but was rejected for unsupported region; the refreshed Gateway authentication succeeded, then the Gateway required a payment card before serving model requests. The user confirmed that the published site's existing AI connection works. Keep that production configuration; no new provider or billing setup is required for production. Live classification with the new prompt still needs verification from an environment where that provider can serve requests.

Run `node --env-file=.env.local --experimental-strip-types scripts/check-conversation-tags.ts` to test six synthetic conversations (inquiry, quote, negotiation, payment, fulfillment and postponement) against the configured provider. This makes AI requests but never sends email or updates CRM records.

The migration preserves legacy categories for existing automations and history. It does not silently convert ambiguous categories into purchasing facts. New controls offer only the ten shared tags. Product-interest notes remain separate from customer situation tags.

The table is server-only with RLS enabled and no browser-role grants, matching the application's existing data-access pattern. The state endpoint authenticates staff and rejects viewer tag edits. Tags applied before a company contact is created are linked by the contact trigger when that contact is saved.

Validation: `tests/customer-tags.test.ts`, `tests/conversation-tagging.test.ts`, `tests/lead-inquiries.test.ts`, the corresponding `*-database.sql` files, and the automation/AI organization regression tests. Database tests use a transaction and roll back their fixtures. October 31 cost-rule verification: 1,092 tests passed; lint, TypeScript and the production build passed. Both database test files passed, including intake while AI is disabled, duplicate/removal protection, ownership, cooldown and exponential retry checks. Live semantic-model verification still has the local provider limitation described above.
