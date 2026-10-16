# Filazoo CRM

Filazoo CRM is the controlled workspace for B2B company research, product matching, catalog generation, outreach approval, and reply handling.

For the complete product vision, current implementation status, architecture, safety rules, and next-step handoff, read [`PROJECT.md`](./PROJECT.md).

The application currently supports two data modes:

- **Demo mode** uses clearly labeled sample records when production credentials or authentication are incomplete.
- **Live mode** reads CRM data from Supabase only when the full server configuration is present and `AUTH_REQUIRED=true`.

## Local development

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
- Explicit demo fallback
- Dry-run outreach safety policy and mock AI diagnostics

Next:

- Company CSV import and audited mutations
- Google Sheets product synchronization
- Personalized live catalog and PDF generation
- Controlled lead discovery and contact verification
- AI profiling and draft generation
- Approval, scheduling, sending, reply classification, and alerts
