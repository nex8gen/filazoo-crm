# Settings and feature audit

Reviewed 2026-10-27 against the application's routes and their data/action handlers.

## Feature coverage

| Feature / pages | User controls and appropriate home |
| --- | --- |
| Overview `/` | Existing date, channel, currency, country, comparison, and widget controls remain on the dashboard. Global theme, language, and reduced motion are available in Settings. |
| Companies `/companies`, company profiles `/companies/[id]` | Account creation, contact details, lifecycle, ownership, tasks, follow-up dates, email, catalogs, purchase orders, invoices, portal, and history stay with the company. Settings controls company list size, table density, email defaults, and personal signature. |
| Segments `/segments` | Segments derive from company records; maintain classifications in company profiles. No second segment configuration source is introduced. |
| Pipeline `/pipeline` | Existing lifecycle stages and ownership actions remain here. Admin team settings determine eligibility for automatic assignment. |
| Email `/emails`, company email views | New account preferences control inbound Chinese translation, automatic read marking, AI writing suggestions, refresh frequency, and signatures. SMTP/IMAP connection, verification, pause/resume, and deletion remain in My mailbox and Team and access. |
| Replies `/replies` | Read-only reply overview uses the existing inbound data. Email reading/sending preferences apply to the actual inbox and company email workspace. |
| Messenger `/messenger` | Channel status, assignments, reply-window controls, and customer conversations stay in Messenger. Connected channels now links directly to this workspace. |
| Meta `/lead-channel/meta` | Existing connection and ingestion controls remain authoritative; Meta submissions use the account's list size preference. |
| AI automation `/lead-channel/ai-agent`, QA subpage, `/automation` redirect | Existing triggers, flow steps, working days, waits, stop-on-reply, activation, and action approvals remain in the automation workspace. Settings provides a direct entry point. Personal inbox AI suggestions do not change automation permissions or execution. |
| Products `/catalogs` | Existing product editing covers price, currency, MOQ, variants, images, and stock. Connected channels links here. |
| Company catalogs `/catalogs/companies` | Existing selection, currency, version, and PDF actions remain here. New account list size and table density apply. |
| Invoices `/invoices`, `/invoices/new`, `/invoices/[id]` | New shared invoice defaults cover legal seller, address, tax ID, currency, payment deadline, initial blank-line tax, instructions, and notes. Existing customer billing overrides and per-invoice adjustments remain available. Payment methods keep their existing settings and role checks. |
| Customer invoice portal `/customer/invoices/[id]` | Issued invoice snapshots and customer access controls remain authoritative. Editing workspace defaults does not rewrite issued invoices or payment/shipping history. |
| Deliverability `/deliverability`, Setup `/setup` | Existing delivery diagnostics and connection readiness stay in their respective screens. Settings links to delivery checks. Provider credentials remain server configuration. |
| Profile, team, access | Existing avatar, display name, invitation, role, removal, assignment eligibility, and shared-mailbox actions remain. Added a real “Sign out other devices” action. |
| Login, recovery, invitation, privacy, data deletion | Existing dedicated security and policy routes remain; no settings control changes authentication requirements or retention policy. |

## Added settings and behavior

Personal preferences are validated on the server and saved under the signed-in Supabase user's `crm_preferences` metadata. Authorization continues to use `workspace_members`, never user metadata. The root preference provider loads from freshly validated Auth data. A reload or a sign-in on another device retrieves the saved choices. No migration is required.

| Setting | Actual consumer |
| --- | --- |
| 10 / 25 / 50 / 100 rows | Companies, company catalogs, Meta submission log, team members |
| Comfortable / compact tables | Shared CRM table CSS cell spacing |
| Reduced motion | Application CSS animation/transition durations and scrolling; OS preference is also honored |
| Inbound Chinese translation | Initial translation switch in inbox and company email workspace |
| Mark opened conversations read | Opening a conversation persists read state only when enabled; manual bulk read/unread actions remain available |
| AI reply suggestions | Initial AI writing suggestion switch; it does not send email |
| Manual / 15 / 30 / 60 / 120 second refresh | Inbox polling, initial automatic synchronization, and focus/visibility refresh; manual-only disables all three automatic paths |
| Plain-text email signature | Actual new email and reply payloads; reply HTML escapes the complete signed text. The composer previews the appended signature. Automation templates are independent. |
| Language | Existing immediate English/Chinese browser preference, now accessible in General |
| Theme | Existing immediate Light/Dark/System browser preference |
| Sign out other devices | Auth `signOut({ scope: "others" })`; current session remains. Existing access tokens may work until expiry. |

Invoice defaults use the existing singleton `invoice_settings.settings` JSON and optimistic concurrency retry helper. One atomic patch saves seller and default fields while retaining payment methods and unrelated fields. Only admins/operators may write; other active members can inspect. The bootstrap used by invoice creation loads these defaults. A saved customer billing profile overrides currency and terms. A customer without a billing profile preserves the workspace deadline. Existing invoice documents are not mutated. Default tax initializes the blank starting line; product imports and additional lines retain their existing explicit tax behavior, so each line must be checked before issuance.

Forms provide pending, success, validation, and failure states. Personal preferences additionally offer discard and restore defaults; restoring defaults requires saving. Settings search includes the new sections. New UI copy has Simplified Chinese coverage.

## Validation

Automated coverage includes preference recovery/validation, current-user metadata writes, denied writes, save failures, session scope, signature deduplication, shared billing authorization, preservation of payment methods, invoice default date rollover, and customer override precedence. Run `npm run verify` for lint, the full test suite, and a production build.

Verification completed: lint passed, all 366 tests passed, and the production build (including TypeScript and static page generation) passed.

Live authentication, cross-device refresh, SMTP delivery, and session revocation require an authenticated connected environment. Automated fixtures validate the application boundaries without sending customer email or revoking real sessions.
