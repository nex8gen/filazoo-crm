# Filazoo CRM - Project Context and Handoff

Last updated: 2026-10-10

This document is the durable source of context for Filazoo CRM. Any new developer or AI chat should read `AGENTS.md` and this file before changing code.

## 1. Product mission

Filazoo CRM is a private B2B sales and outreach system for the filament business. Its purpose is to find suitable organizations worldwide, build reliable company memory, match each prospect with relevant products, prepare personalized outreach and catalogs, manage replies, and alert the Filazoo team when a large order opportunity appears.

Target organizations include:

- 3D-printing farms
- 3D-printing service bureaus
- Rapid-prototyping companies
- Filament distributors
- 3D-printing resellers
- Industrial manufacturers using FDM printing
- Engineering companies
- Universities and laboratories
- Makerspaces and training centers

## 2. Intended end-to-end workflow

The complete system should eventually perform this controlled workflow:

1. Discover relevant companies by country, segment, size, and buying signals.
2. Research the company website and permitted public sources.
3. Find and verify business contact information.
4. Create a persistent company record containing evidence, contacts, fit score, likely product needs, interests, and previous activity.
5. Match the company with appropriate Filazoo products.
6. Generate a personalized email draft for human review.
7. Generate a focused PDF catalog containing only relevant products, specifications, and current prices.
8. Read product and price changes from a manually maintained Google Sheet.
9. Regenerate catalogs automatically after product or price changes, with a scheduled weekly check.
10. Send only approved outreach and maintain suppression, unsubscribe, bounce, and sending-limit protections.
11. Detect and classify replies, draft follow-ups, and preserve the full conversation history.
12. Alert the Filazoo team when a prospect signals a large order or high-value opportunity.

The goal is not uncontrolled bulk email. The production system must be evidence-based, auditable, permission-aware, rate-limited, and human-approved until every safety mechanism has been tested.

## 3. Current product state

The application is an existing Next.js 16.4 App Router project using TypeScript, Tailwind CSS, shadcn-style components, Base UI, Supabase, and Vercel-compatible deployment.

Current branch: `main`

GitHub repository: `https://github.com/nex8gen/filazoo-crm.git`

The local `main` branch and GitHub `main` were synchronized through commit `68aeca9` before this document was added.

### Implemented interface

- Premium responsive application shell
- Collapsible desktop sidebar and mobile navigation
- Dashboard
- Companies table and company detail sheet
- Pipeline/Kanban interface
- Emails screen
- Replies screen
- Catalogs screen
- Settings and team-management screen
- Automation diagnostics screen
- Setup/readiness screen
- Dark and light themes
- Command palette and page navigation
- Loading, empty, and error-state components
- Working company creation with optional primary contacts and audit events
- CSV company export
- Persistent opportunity creation and pipeline drag-and-drop stage updates
- Safe email-draft creation that never sends from the creation flow
- Catalog selection/version creation with product and currency choices
- Role-aware mutation controls for administrators, operators, and read-only viewers

### Implemented authentication

- Supabase email/password login
- Secure cookie-backed server sessions
- Protected CRM routes
- Logout
- Forgot-password request
- Password recovery callback
- Password update
- Email confirmation handler
- Invalid/expired-link screen
- Real user identity in the top-bar menu
- Workspace membership checks
- `admin`, `operator`, and `viewer` roles
- Admin team invitations
- Admin role management
- Profile display-name updates
- Safe internal redirects
- Strong password validation
- Server-side authorization repeated inside sensitive actions

This is a private workspace. There is intentionally no public self-registration page. New users should be invited by an administrator.

### Implemented Supabase foundation

- Database schema in `supabase/schema.sql`
- Alignment migration in `supabase/migrations/20261009_align_crm_model.sql`
- Extension/index hardening migration
- Server-only Supabase administrator client
- Browser and server authentication clients
- Workspace authorization table
- Live database-backed data-access layer
- Idempotent, clearly labeled sample dataset for CRM demonstrations
- Health endpoint at `/api/health`
- Live/demo mode detection

Important database entities include:

- `workspace_members`
- `companies`
- `company_profiles`
- `contacts`
- `pipeline`
- `emails`
- `events`
- `products`
- `catalogs`
- `product_sync_runs`
- `suppression`

At least one confirmed administrator already exists in Supabase Auth and `workspace_members`. Never put that user's password in documentation, source code, commits, issues, or chat.

### Implemented safety and prototype logic

- Dry-run outreach policy
- Daily sending-limit checks
- Suppression checks
- Verification-status checks
- Bounce-threshold pause logic
- Mock AI company profiling endpoint
- Automation readiness diagnostics
- Tests for CRM mapping, redirect safety, outreach policy, mock AI output, and password strength

## 4. What is still a prototype or not implemented

The user interface is ahead of the automation backend. Do not describe the following as production-ready:

- Automatic worldwide lead discovery
- Contact/email enrichment provider integration
- Email verification provider integration
- Live AI research and personalization
- Google Sheets product synchronization
- Branded PDF catalog rendering
- Weekly catalog regeneration job
- Production mailbox sending
- Inbound mailbox/reply ingestion
- Automated follow-up sequences
- Big-order notifications
- CSV company import and complete audited edit/delete operations
- Complete compliance, unsubscribe, bounce, and deliverability workflow
- Production monitoring and job retry infrastructure

Some screens may display empty live states until records are added to Supabase. Demo/sample data must always be clearly identified and must never be confused with real prospects.

## 5. Architecture and source map

### Application

- `app/` - Next.js routes, pages, route handlers, and Server Actions
- `components/` - shared application components
- `components/ui/` - reusable shadcn/Base UI primitives
- `app/crm-actions.ts` - authorized, validated CRM mutations and audit-event writes
- `lib/data/crm.ts` - authorized CRM reads and database-to-UI mapping
- `lib/data/members.ts` - administrator team/member reads
- `lib/auth.ts` - current user and workspace authorization
- `lib/supabase/` - browser, server, administrator, and proxy clients
- `lib/outreach-policy.ts` - sending safety rules
- `lib/ai/mock-agent.ts` - non-production AI prototype
- `lib/env.ts` - validated environment configuration
- `lib/types.ts` - shared application types
- `tests/` - Node test suite
- `scripts/seed-sample-data.ts` - dry-run-only sample CRM seed with deterministic IDs

### Authentication flow

1. `proxy.ts` refreshes the Supabase session and redirects unauthenticated requests.
2. `lib/auth.ts` validates the user claims and workspace membership.
3. Protected data functions and Server Actions re-authorize the user.
4. The secret Supabase key is used only in server-only modules.
5. Public auth pages are `/login`, `/forgot-password`, `/update-password`, and `/auth/*`.

### Data access rule

Browser code must never query protected CRM tables using an administrator key. Protected reads and writes belong in the server data-access layer after workspace authorization. Never expose the Supabase secret key to client components.

## 6. Environment and deployment

Local secrets are stored in `.env.local`, which must remain uncommitted. Do not overwrite it unless the user explicitly asks.

### Current Vercel production status

- Vercel project: `nex8gens-projects/filazoo-crm`
- Production origin: `https://filazoo-crm.vercel.app`
- Production deployment verified on 2026-10-10: `dpl_4tSsffJQiMpfUTQFnmvRBURUdCTi`
- `NEXT_PUBLIC_APP_URL` points to the production origin.
- `AUTH_REQUIRED=true` and `DRY_RUN=true` are enforced in Production.
- `/api/health` reports the Supabase database connected and dry-run enabled.
- Unauthenticated requests to `/` redirect to `/login`.
- Vercel Deployment Protection remains enabled; do not disable it for automated checks because `vercel curl` can authenticate safely.

Required live configuration:

```text
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
AUTH_REQUIRED=true
DRY_RUN=true
```

`NEXT_PUBLIC_APP_URL` must be the actual deployed origin in Vercel, not `localhost`.

Supabase Auth should allow these redirects, replacing the example production origin with the real domain:

```text
http://localhost:3000/auth/callback
http://localhost:3000/update-password
https://YOUR-DOMAIN/auth/callback
https://YOUR-DOMAIN/update-password
```

The equivalent environment variables must be configured in Vercel; `.env.local` is not uploaded automatically.

Keep `DRY_RUN=true` until live sending has approval, suppression, unsubscribe, bounce handling, mailbox authentication, monitoring, and end-to-end tests.

## 7. Current security notes

- No secret key or password should be committed.
- CRM tables have RLS enabled and are currently accessed through the authorized server data layer. The Supabase advisor reports informational notices because those tables do not have browser-facing RLS policies.
- Supabase leaked-password protection was reported as disabled and should be enabled in the Supabase Auth dashboard.
- A role check in the UI is never sufficient; every Server Action and route must authorize independently.
- Do not add public signup unless the product owner explicitly changes the private-workspace requirement.
- Preserve generic password-recovery responses so email addresses cannot be enumerated.

## 8. Verification status

At the time of this handoff:

- ESLint passes.
- All 11 automated tests pass.
- The Next.js production build passes.
- `/api/health` reports the Supabase database connected in the configured local environment.
- Unauthenticated access to protected CRM pages redirects to `/login`.
- Auth pages render without the CRM sidebar or top bar.
- The recent Next.js development diagnostics were fixed, including session-time prerendering, command palette context, Base UI link semantics, and user-menu grouping.

Run the full verification suite after every meaningful change:

```bash
npm run verify
```

Seed or refresh the synthetic demonstration records (safe to rerun):

```bash
npm run seed:sample
```

The seed refuses to run when `DRY_RUN=false`. Its companies and products use
`[SAMPLE]` labels, and all contact addresses use reserved `.example` domains.

Local preview:

```bash
npm run dev
```

Then open `http://localhost:3000`.

## 9. Recommended implementation order from here

### Phase 1 - Make CRM records operational

1. Add audited company/contact create and edit actions.
2. Add a controlled CSV import with validation, deduplication, and preview.
3. Add pipeline mutation history and activity events.
4. Add contact verification and suppression fields to the interface.

### Phase 2 - Product source and catalogs

1. Define the Google Sheet columns and validation rules.
2. Build a read-only product sync preview.
3. Add an approved sync action and `product_sync_runs` audit records.
4. Build the branded HTML catalog template.
5. Render and store focused PDF catalogs.
6. Add the weekly scheduled regeneration workflow.

### Phase 3 - Research and company memory

1. Choose compliant discovery and enrichment sources.
2. Store evidence URLs, timestamps, and confidence for every derived fact.
3. Add deduplication by normalized domain.
4. Add AI profiling with structured, validated output.
5. Require human review for uncertain contacts or product matches.

### Phase 4 - Controlled outreach

1. Connect the approved Google Workspace mailbox.
2. Configure SPF, DKIM, DMARC, and a dedicated sending subdomain.
3. Generate drafts only; require approval initially.
4. Enforce suppression, unsubscribe, verification, rate, and bounce rules.
5. Attach only the prospect-specific approved catalog.
6. Record provider message IDs and immutable send events.

### Phase 5 - Replies and high-value alerts

1. Ingest inbound replies idempotently.
2. Classify reply intent and confidence.
3. Draft follow-ups for human approval.
4. Detect large-order signals using explicit criteria.
5. Alert the Filazoo team by the selected internal channel.
6. Add monitoring, retries, dead-letter handling, and audit views.

## 10. Decisions that still require the product owner

Before production automation, confirm:

- Primary pilot country and first customer segment
- Approved lead/contact data providers
- Legal/compliance rules for each outreach region
- Google Sheet ownership and final column structure
- Exact Filazoo catalog design assets
- Pricing currency, tax, shipping, and validity rules
- Sending mailbox and daily volume ramp
- Human approval rules and which roles can approve
- Definition of a "big order" by quantity or value
- Alert destination: email, Slack, Telegram, or another channel
- AI provider/model and monthly budget

## 11. Instructions for a new chat or developer

Use this startup sequence:

1. Read `AGENTS.md` completely.
2. Read this `PROJECT.md` completely.
3. Inspect `git status` and preserve unrelated user changes.
4. Check the current branch and recent commits.
5. Before changing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` because this project uses Next.js 16.4 with breaking changes.
6. For Supabase work, inspect the existing server/auth/data-access patterns before adding a new client.
7. Never read aloud, print, commit, or paste secret environment values.
8. Keep live outreach disabled unless the user explicitly authorizes production sending and all safety gates are complete.
9. Implement the smallest complete vertical slice, then run `npm run verify`.
10. Update this document whenever architecture, integrations, deployment requirements, or project status materially changes.

## 12. Definition of success

Filazoo CRM is complete when the team can safely move from an evidence-backed prospect to a verified contact, approved personalized message, relevant current-price catalog, recorded conversation, and actionable large-order alert - with audit history and human control at every high-risk step.
