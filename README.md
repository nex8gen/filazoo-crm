# Filazoo CRM

Filazoo CRM is the controlled workspace for B2B company research, product matching, catalog generation, outreach approval, and reply handling.

For the complete product vision, current implementation status, architecture, safety rules, and next-step handoff, read [`PROJECT.md`](./PROJECT.md).

The application reads CRM records from Supabase only when the full server configuration is present and `AUTH_REQUIRED=true`. Without that connection, data views render honest empty/offline states; they do not inject sample records.

## Local development

### Email translation

Inbound English emails use Google's unofficial free translation endpoint by default, with no API key or MyMemory daily character allowance. This endpoint has no availability or unlimited-use guarantee and may throttle requests. Translation errors appear with the existing Retry action; AI writing uses its own configuration.

For control over quotas, run your own [LibreTranslate server](https://docs.libretranslate.com/guides/installation/) with English and Chinese models (`libretranslate --load-only en,zh`). Set server-only `LIBRETRANSLATE_URL` to its base URL (for example, `http://localhost:5000` locally), and optionally `LIBRETRANSLATE_API_KEY` if your server requires authentication. Restart or redeploy the CRM after changing these values. The configured server receives message text, and the CRM does not fall back to Google when it is unavailable. In production, use a secured server URL reachable from the CRM host; localhost refers to that host. Self-hosting removes the external daily quota when configured without request limits, but requires server resources. The existing 20,000-character per-message request limit remains.

### AI follow-up automation

See [the complete flow customization audit](docs/flow-verification.md) for trigger/action coverage and verification limits. Assigned tasks and internal alerts are available from the header bell and `/tasks`. Apply `supabase/migrations/20261027073153_flow_list_enrollment.sql` for activation-safe Shopify/Meta source-list enrollment. The catalog email template now attaches a generated PDF; previews and actual execution share the template content and business-hour scheduling rules.

The builder at `/lead-channel/ai-agent` uses company segments from the CRM. Waits, both condition branches, email options, task assignment, category changes, alerts, and stop outcomes execute on the server. Times in wait and business-hour settings are UTC. Existing runs retain their enrolled steps when a flow is edited; pausing preserves waiting runs.

For automatic lead replies, choose **New lead → Any segment → Wait 5 minutes → AI auto-reply**. The AI action reads the latest authorized conversation when it runs, uses active CRM product information, resolves quoted prices from current CRM quantity tiers and exact variants, and can attach a freshly generated product catalog PDF to the first automated message. Leads with no email history receive a welcome introduction. You can set writing instructions, reply language, sender mailbox and send window. Switching a wait to minutes or hours clears the day-based resume time and weekend restriction; these can still be set explicitly.

Use **Test with emails** before turning on a flow. **Send real test emails** takes one sample incoming email and an explicit test recipient. It follows configured waits (up to one hour total), generates replies with the live AI/product/catalog code, sends through the selected authorized SMTP mailbox, and records accepted messages in Sent. Keep the dialog open: it advances only this test through authenticated polling, without relying on the production cron. The flow definition and CRM contacts are unchanged; tasks, alerts and category changes are simulated. Explicit real tests send even when production `DRY_RUN` is enabled, while suppression, unsubscribe and daily send limits still apply. Duplicate starts and concurrent polls cannot resend a claimed action; interrupted sends are terminal and must be checked in Sent before starting another test. Apply `20261027063225_flow_real_email_tests.sql` first.

Disable **Send real test emails** for a preview of up to three samples without sending or saving anything. Preview waits are simulated immediately. Each sample is assumed to match trigger filters, with opens/clicks/later replies initially false. Both modes use the first-message switch, current CRM products and prices, the same AI reply generator, and real catalog PDF generation. Delivery tests identify their subject with `[Flow test]` and do not add production open/click tracking.

Apply `supabase/migrations/20261026101057_flow_ai_auto_reply.sql` for the new trigger and action. New-lead enrollment begins when the flow is enabled or resumed, excluding existing leads and leads created while paused. Manual company/contact creation, Shopify intake, and Meta intake enroll saved contacts immediately; the scheduled scanner recovers missed enrollment using the same contact event key to prevent duplicate sends. Form submissions trigger **New lead**, not **Email received**. AI replies use the existing Gemini / AI Gateway server configuration. Live activation checks the provider and SMTP mailbox. Website/Meta inquiries (`shopify_b2b_form`, `shopify_b2b_form_opt_in`, `meta_lead_ads`) and contacts with received customer emails can receive automated replies while their verification status is `unverified` or `unknown`; this does not mark them verified or relax cold-outreach checks. Unsubscribed, suppressed, invalid and risky addresses remain blocked, as do daily sending limits. Dry-run execution records the proposed action without making AI calls or sending emails. Saving a draft does not turn it on.

Apply `supabase/migrations/20261022040419_automation_atomic_save.sql` before using the updated flow API. Configure `NEXT_PUBLIC_APP_URL` to the public CRM origin for signed open/click links. Open tracking depends on the recipient loading images; mail privacy proxies and link scanners can affect engagement signals.

The production scheduler uses Supabase `pg_cron` and `pg_net` with `supabase/migrations/20261027065547_live_flow_scheduler.sql`. Two jobs run every minute: `filazoo-flow-resume` calls `/api/cron/flows?task=resume` to resume due waits and recover saved events; `filazoo-flow-inbox` calls `/api/cron/flows` to also sync mailboxes. Slow IMAP logins do not hold up the separate wait worker. The first wait starts at lead creation or email receipt, so normal execution is due after the configured wait plus up to one polling interval and AI/SMTP processing time. Existing run locks and event keys prevent duplicate sends. Self-sent mailbox copies are excluded from customer inquiry automation.

Store the public CRM origin in Vault as `flow_cron_origin` and the matching Vercel `CRON_SECRET` as `flow_cron_secret`; never put credential values in migration files. The migration installs both jobs disabled. Enable them with `cron.alter_job(jobid, active := true)` only after the deployed authenticated `/api/cron/flows?task=health` returns `version: "flow-live-v1"` and the intended `liveSending` value. Inspect `cron.job_run_details` for scheduler execution and `net._http_response` for HTTP success/errors. Incoming-email flows have a server-managed activation boundary, excluding historical messages and messages received while paused. Mailbox messages still need to match saved CRM contacts and the live flow's filters.

`vercel.json` retains a daily backup tick compatible with Hobby; a local `next dev` process does not run scheduled jobs itself. Keep local `DRY_RUN=true`. Production live sending requires `DRY_RUN=false`, an eligible inquiry/verified contact, and a configured SMTP mailbox.

`Audit flow` validates and simulates the current draft without sending messages. Real run events and errors appear under Insights. To verify the database runtime and HTTP endpoints with disposable records and forced dry-run email delivery, run:

```powershell
node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/verify-flows.ts
```

The integration script requires the local dev server at `http://localhost:3000` (or `FLOW_TEST_ORIGIN`) and cleans up its temporary CRM records.

To verify AI lead enrollment, conversation lookup, PDF generation, first-message attachments and dry-run execution against the database, run `node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/verify-flow-ai-reply.ts`. This check intercepts AI provider requests, forces dry-run delivery, and removes its disposable records.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Supabase setup

For a new project, run `supabase/schema.sql` in the Supabase SQL editor.

If the earlier schema was already installed, run this migration instead:

```text
supabase/migrations/20261009_align_crm_model.sql
supabase/migrations/20261012_meta_messenger_messages.sql
```

Create the first user in Supabase Auth, then authorize that user explicitly:

```sql
insert into public.workspace_members (user_id, role, display_name)
values ('AUTH_USER_UUID', 'admin', 'Filazoo admin');
```

Only `admin`, `operator`, and `viewer` workspace members can read live CRM data. The browser key cannot query CRM tables; the server data-access layer checks membership before using the Supabase secret key.

## Required live-mode environment

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
AUTH_REQUIRED=true
DRY_RUN=true
```

Keep `DRY_RUN=true` until suppression, approval, mailbox authentication, unsubscribe, bounce, and end-to-end tests are complete. Never commit `.env.local` or paste secret values into chat.

## Facebook Messenger and Lead Ads

### Simple Instant Form connection (Make)

Open **Meta Leads** in the CRM sidebar (`/lead-channel/meta`). This is the simpler option for ad form submissions: use Make's Facebook Lead Ads **New Lead** instant trigger, then its HTTP module to POST JSON to `/api/meta/lead-bridge`. Make handles the Facebook connection; this path does not require a custom Meta Developer app or a Meta Page token in the CRM.

The CRM automatically derives a separate bridge credential from its existing server-only database key using a domain-separated HMAC. The admin setup panel shows this credential, the callback, field mapping, and test steps. Use `Authorization: Bearer <connection secret>` in Make. For independent rotation, optionally set server-only `META_LEAD_BRIDGE_SECRET` to a random value of at least 32 characters and redeploy. Rotating the database key also rotates the derived bridge credential. Set `NEXT_PUBLIC_APP_URL` to the public CRM origin. The callback domain must be reachable without deployment authentication. Never put the secret in a URL or a `NEXT_PUBLIC_` variable.

Map `lead_id` and `page_id` as their original numeric Meta IDs **encoded as strings**, plus `full_name`, `email`, and/or `phone`. Optional fields: `form_id`, `ad_id`, `created_time` (ISO datetime), and `field_data` (`[{"name":"question","values":["answer"]}]`). Omit missing optional values. The receiver rejects ID-only notifications; retrieve the form answers in Make before forwarding. It returns 201 for a new lead, 200 for a duplicate, and a non-2xx status for a failure so Make can retry. Keep error retries enabled in Make.

Apply `supabase/migrations/20261022070000_meta_lead_companies.sql` before deploying the receiver. A database trigger atomically creates or matches the company, contact, and pipeline record for every Meta ingestion path. Existing contacts match by email; companies match by business domain, while personal email providers never merge unrelated businesses. Existing pipeline stages and owners are preserved. Form answers, phone, and original submission time are retained in company activity. Contacts stay unverified and unsubscribed contacts remain suppressed.

Manage Meta leads on **Companies**, alongside Shopify leads. The Meta Leads page is a connection log showing the latest 100 submissions with 15-second refresh; BD managers only see their assigned records. Repeated deliveries preserve saved answers and ownership. In Make, map New Lead's **Lead ID**, **Page ID**, **Form ID**, **Ad ID**, and **Mappable field data** array into the corresponding receiver fields. Both native `{name,values:[...]}` and Make `{name,value}` answer formats are accepted. Structured JSON handles quotes and line breaks safely.

For a historical import, normalize the exported IDs as strings (remove Meta CSV's `l:`, `f:`, and `ag:` prefixes), retain original `created_time`, and keep all form answers in `field_data`. Store exports in an ignored/private directory. Preview with `node --env-file=.env.local --experimental-strip-types scripts/import-meta-leads.mjs PATH_TO_PRIVATE_JSON`, then add `--execute` to import. Reruns skip existing IDs. For previously saved unlinked records, updating `field_data` to itself invokes the company-linking trigger. The rollback-only database integration checks are in `tests/meta-company-link.sql`. This connection does not import campaign performance or create Messenger conversations.

### Direct Meta connection (advanced)

The Meta integration is for a Facebook Page, not WhatsApp. Add these server-only variables in Vercel Production and redeploy after changing them:

```text
META_FACEBOOK_PAGE_ACCESS_TOKEN
META_FACEBOOK_PAGE_ID
META_WEBHOOK_SECRET
META_VERIFY_TOKEN
META_GRAPH_API_VERSION=v26.0
```

Use `https://YOUR_PUBLIC_DOMAIN/api/meta/webhook` as the Meta Page webhook callback. The callback is public at the Filazoo authentication layer, while POST requests require Meta's `x-hub-signature-256` signature. The deployment hostname itself must not be behind Vercel Authentication; use an unprotected custom domain or adjust Deployment Protection.

In the Meta app, connect the Facebook Page and subscribe the Page webhook to `messages`, `messaging_postbacks`, and `leadgen`. Messenger replies require `pages_messaging`; Lead Ad detail retrieval requires `leads_retrieval` and the Page permissions required by Meta for that app and business. Never put the Page access token or App Secret in a `NEXT_PUBLIC_` variable.

For Instagram Direct, use Messenger API support for Instagram: link the professional Instagram account to the Facebook Page, grant the Page permission to manage Instagram messages, generate a new Page access token, and subscribe the same callback to Instagram messaging events. Facebook and Instagram replies share the server-only Page access token; the CRM separates the two channels using each webhook event's source.

## Shopify B2B form leads

The Shopify Forms app should add the customer tag `b2b-lead` when the B2B form is submitted. Add these server-only variables in Vercel Production:

```text
SHOPIFY_WEBHOOK_SECRET
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_B2B_FORM_TAG=b2b-lead
```

Create a Shopify `customers/create` webhook subscription with JSON format and this callback URL:

```text
https://YOUR_PUBLIC_DOMAIN/api/shopify/webhook
```

The callback verifies Shopify's `X-Shopify-Hmac-Sha256` signature and store domain, ignores customers without the configured B2B tag, and deduplicates retries by `X-Shopify-Webhook-Id`. A valid lead creates or matches a CRM company by website/email domain, creates or updates the contact by email, adds the company to the `new` pipeline stage, and records an audit event. Apply `supabase/migrations/20261016_shopify_b2b_leads.sql` before enabling the webhook. Company, website, and job-title values can also be read from customer notes formatted as `Field: Value`; standard Shopify address company/country/city fields are preferred.

The live `/pages/b2b` page uses Shopify's native contact form rather than Shopify Forms/customer creation. Its theme section mirrors each valid submission to `/api/shopify/form-lead` with `navigator.sendBeacon` while preserving Shopify's normal `/contact` submission and confirmation experience. The mirror accepts only `https://filazoo.com`, validates the form identifier and honeypot, deduplicates by browser-generated submission ID, and stores every optional wholesale field in the lead audit event.

## Verification

```bash
npm run verify
```

This runs ESLint, the Node test suite, TypeScript through the Next.js build, and a production build.

Company follow-up reminders are synchronized by the database for profile edits,
opportunity edits, and owner changes. Apply
`supabase/migrations/20261026063746_crm_company_action_connections.sql` before
deploying the company-action updates. Assignment updates the pipeline, Meta and
Shopify source ownership, reminder owner, and activity history in one transaction.
Run `tests/company-action-connections-database.sql` against the connected database
to check scheduling, rescheduling, cancellation, assignment, and permissions. Its
fixtures and changes are rolled back. `scripts/check-flow-mailbox.ts` checks SMTP
and IMAP without sending mail; `scripts/verify-flows.ts` runs the existing dry-run
automation integration checks and cleans up its disposable records.

## Current scope

Member deletion redistributes customer assignments among active BD Sales Managers
with automatic assignment enabled, prioritizing managers with fewer customers.
Linked Meta/Shopify leads and follow-up tasks transfer with the customer; if no
eligible manager remains, customers stay unassigned. Apply
`supabase/migrations/20261027010510_redistribute_removed_member_customers.sql`
before deploying the updated settings action. Removal, reassignment, automation
cleanup, and audit history commit together. Run
`tests/member-removal-database.sql` for rollback-only database integration checks.

Implemented:

- Supabase schema and migration
- Supabase Auth session handling
- Workspace role enforcement
- Server-only CRM data-access layer
- Database-backed dashboard, companies, pipeline, email queue, and catalog views
- Explicit empty/offline fallback when live data is unavailable
- Dry-run outreach safety policy and mock AI diagnostics

Next:

- Company CSV import and audited mutations
- Google Sheets product synchronization
- Personalized live catalog and PDF generation
- Controlled lead discovery and contact verification
- AI profiling and draft generation
- Approval, scheduling, sending, reply classification, and alerts
