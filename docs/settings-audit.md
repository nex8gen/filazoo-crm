# Settings and feature audit

Originally reviewed 2026-10-27 against the application's routes and their data/action handlers. Settings organization and interaction were reworked on 2026-10-30.

## Settings rework — 2026-10-30

The navigation now has four task-based groups: Personal, Email & connections, Billing, and Workspace. A shared section registry drives navigation, section titles, descriptions, role visibility, and multiword search, including Chinese keywords. Mobile uses an expandable menu instead of a horizontally scrolling collection of categories. Account preference controls stay available; the duplicate Connected channels entry redirects to Apps & connections. Its useful workflow links remain available there. Lead assignment replaces the vague Assignment and automation navigation title; automation editing remains in the automation workspace.

The switch treatment follows [Apple's toggle guidance](https://developer.apple.com/design/human-interface-guidelines/toggles) and the [W3C switch pattern](https://www.w3.org/WAI/ARIA/apg/patterns/switch/). It uses the existing Base UI switch primitive for keyboard interaction, checked state, labels, descriptions, disabled state, and native form serialization. The pill track and white thumb animate between positions, with visible focus and reduced-motion support. Preference switches, mailbox defaults, mailbox activation, ERP activation, and member assignment use the same control. Warehouse selection remains a checkbox because it selects members of a set.

Personal list, display, and email preferences save immediately. Controls show the proposed state while saving, prevent simultaneous edits, report successful persistence, and restore the last saved value on failure. Restore defaults affects only the current section and persists it. Theme and language apply immediately to the browser and explicitly state their scope. Theme thumbnails and a table-density preview show the effect of the choice. Billing, credentials, member access, and rich email footer editing retain their explicit save actions.

Available apps are shown by default. Planned integrations remain in the Coming soon filter, where their action says View details rather than suggesting an unavailable connection can be activated. Existing connected accounts remain accessible in My email, Team email, and the Connected filter.

Two functional fixes accompany the visual work: omitted unchecked fields now validate correctly when disabling lead assignment or default-mailbox selection; settings runtime data is wrapped in an explicit Suspense boundary with the updated settings loading skeleton. Session-action exceptions now produce visible feedback.

New regression coverage checks role-aware search, nested navigation, Chinese keywords, and actual settings actions with omitted/off and native on values. Live browser verification confirmed account preference persistence after reload and mobile navigation/search without horizontal overflow. No customer messages, invitation emails, credential changes, or session revocations were performed during verification.

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

Forms provide pending, success, validation, and failure states. Personal preferences now save automatically and offer section-specific restore defaults. Forms with multiple editable business or connection fields keep explicit saving. Settings search includes all active sections. New UI copy has Simplified Chinese coverage.

## Validation

Automated coverage includes preference recovery/validation, current-user metadata writes, denied writes, save failures, session scope, signature deduplication, shared billing authorization, preservation of payment methods, invoice default date rollover, and customer override precedence. Run `npm run verify` for lint, the full test suite, and a production build.

Original 2026-10-27 verification: lint passed, all 366 tests passed, and the production build (including TypeScript and static page generation) passed. For the 2026-10-30 working tree, all 49 targeted settings, connection, billing, and member-action tests passed. Lint on the changed code, TypeScript, whitespace checks, and the final production build passed. The full suite passed 960 of 966 tests; the six failures were in the separate task data/translation work, not settings. Browser checks confirmed the motion preference persisted after reload and was restored to its original value; mobile email settings and search worked at 390 px without horizontal overflow. Later live navigation checks encountered a workspace session-fetch failure, and the separate production preview required a fresh sign-in. Live provider reconnection and access-changing actions were not exercised.

Live authentication, cross-device refresh, SMTP delivery, and session revocation require an authenticated connected environment. Automated fixtures validate the application boundaries without sending customer email or revoking real sessions.
