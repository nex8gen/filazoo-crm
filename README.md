# Filazoo CRM

Filazoo CRM is the controlled workspace for B2B company research, product matching, catalog generation, outreach approval, and reply handling.

For the complete product vision, current implementation status, architecture, safety rules, and next-step handoff, read [`PROJECT.md`](./PROJECT.md).

The application reads CRM records from Supabase only when the full server configuration is present and `AUTH_REQUIRED=true`. Without that connection, data views render honest empty/offline states; they do not inject sample records.

## Local development

### AI follow-up automation

The builder at `/lead-channel/ai-agent` uses company segments from the CRM. Waits, both condition branches, email options, task assignment, category changes, alerts, and stop outcomes execute on the server. Times in wait and business-hour settings are UTC. Existing runs retain their enrolled steps when a flow is edited; pausing preserves waiting runs.

Apply `supabase/migrations/20261022040419_automation_atomic_save.sql` before using the updated flow API. Configure `NEXT_PUBLIC_APP_URL` to the public CRM origin for signed open/click links. Open tracking depends on the recipient loading images; mail privacy proxies and link scanners can affect engagement signals.

The worker imports mailbox messages before scanning inbound/no-reply triggers and resuming due runs. `vercel.json` invokes `/api/cron/flows` every minute; configure a strong `CRON_SECRET` in the deployment environment. Vercel's per-minute cron requires Pro or Enterprise. On Hobby, use an external scheduler with `Authorization: Bearer <CRON_SECRET>` or a suitable hosting plan. A local `next dev` process does not run Vercel cron automatically. Keep `DRY_RUN=true` while testing; live sending also requires a verified contact and configured SMTP mailbox.

`Audit flow` validates and simulates the current draft without sending messages. Real run events and errors appear under Insights. To verify the database runtime and HTTP endpoints with disposable records and forced dry-run email delivery, run:

```powershell
node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/verify-flows.ts
```

The integration script requires the local dev server at `http://localhost:3000` (or `FLOW_TEST_ORIGIN`) and cleans up its temporary CRM records.

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

## Current scope

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
