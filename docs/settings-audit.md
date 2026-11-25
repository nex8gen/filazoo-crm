# Settings and feature audit

## Current review — 25 November 2026

All 13 destinations in the settings registry were reviewed against their components, saved values, consumers, and authorization checks. This is a code and automated-interaction review. Browser and Windows preview connections were unavailable, so visual appearance, mobile interactions, and live provider operations have not been verified in this review.

| Section | Decision and resulting behavior |
| --- | --- |
| General | Removed the nonfunctional Start page block and its navigation claims. Current sign-in behavior opens Home. Language and list size remain; historical saved start-page values are retained for compatibility. Removed the duplicate English subtitle. |
| Appearance | Kept Light/Dark/System, table density, the density preview, and reduced motion: these have real consumers. Theme remains a browser preference; density and motion remain account preferences. |
| Profile | Kept photo, display name, and the read-only sign-in email. Added matching name-length limits, pending-state disabling, discard, and unsaved-edit protection. Moved Alipay sign-in out of Profile. |
| Security and login | Grouped password, supported sign-in options, and other sessions. Removed workspace role and implementation-specific cookie text. Alipay appears only when enabled or already linked. Session revocation keeps its existing server-side scope. |
| Email preferences | Kept translation, read marking, writing suggestions, and inbox refresh. Shortened descriptions without changing behavior. Footer editing now has a separate card and unsaved-edit protection; load failures remain visible. |
| Workspace | Non-admins can see the workspace name. Legacy workspaces display an honest unavailable state. Ownership transfer identifies the recipient and requires confirmation; leaving also requires confirmation. Successful rename and ownership changes invalidate the shared layout. |
| AI access and behavior | Kept actual feature, data, action, and writing controls. Replaced a full-policy reset with an action that changes automatic permissions to approval-required while preserving denied actions, disabled features/data, and business guidance. Added duplicate-save protection. Save status is inline; opening the page no longer triggers a success toast. |
| Team and access | Added contextual explanations for the selected invitation role and blocked edits during submission. Legacy workspaces no longer offer an invitation form that cannot succeed. Invitation-load failures remain visible. Existing role and member-removal authorization is retained. |
| Lead assignment | Kept distribution rules, workload definition, capacity, participation, and the non-mutating preview. Added unsaved-edit protection; load failures remain visible. Saving does not redistribute existing leads. |
| Apps and connections | Removed unrelated workspace shortcuts and repeated connection guidance. Connected email apps open the appropriate account list. Ordinary members receive View details for administrator-managed integrations, and administrator-only ERP entries stay out of their library. Personal/team access checks remain on the server. |
| ERP connection | Kept credential testing, IP discovery, warehouse filters, stock scheduling, and SKU mapping: each has a real operational purpose. Added unsaved-edit protection and removed a nested width limit that left excess space on the right. Secrets stay server-side. |
| Plan and AI credits | Retained real plan status, credit balance, renewal, resource usage, refresh, and owner-controlled purchases. The title now follows the wider billing column. No purchase or subscription was changed during review. |
| Invoices and payments | Retained seller identity, currency, terms, initial-line tax, invoice instructions, and saved customer payment methods. Added payment-method discard and disabled unchanged saves. Existing role checks, issued-invoice preservation, and concurrent settings patches are retained. |

Across settings, the page column stays centered with left-aligned contents. Repeated ownership badges were removed; navigation groups and relevant permission guidance identify scope. Loading placeholders now follow the same column width without adding a duplicate page heading. A settings-specific error boundary offers retry for unexpected section failures. New copy has Simplified Chinese translations.

Seven new behavioral regressions cover ownership review/cancel/submit, leave review/cancel/submit, AI approval changes without policy expansion, duplicate policy submissions, read-only AI policies, role-aware app destinations, localization, and connection drafts across failed/successful saves. Existing settings action suites cover credentials, saved preferences, billing, usage limits, and ERP permissions.

Validation for this review:

- **123 focused tests passed**, covering settings, connections, preferences, AI policy/usage, lead assignment, ERP, invoices/payments, email footers, authentication destinations, and localization behavior.
- ESLint passed on all changed application and test files. TypeScript (`npx tsc --noEmit`) passed. Both changed stylesheets parsed successfully, and the settings diff passed whitespace checks.
- The full checkout suite finished with **2,787 passes and 3 failures out of 2,790 tests**. The failures were outside settings: `flow-inquiry.test.ts` could not resolve `../flow-mailboxes.ts`; `flow-visibility.test.ts` expected the old `wf-show-actions` control; and `i18n-coverage.test.ts` reported untranslated text elsewhere in the application. New settings copy was absent from that missing-translation list.
- Production build verification is blocked: `FILAZOO_STABLE_RUNTIME=1 npm run build -- --webpack` exhausted Node's 4 GB heap during compilation, and a retry with a 6 GB heap also exhausted memory. The existing development server was left running. No successful production-build or live visual-verification claim is made.

The review follows [W3C form guidance](https://www.w3.org/WAI/tutorials/forms/instructions/) for useful instructions and required inputs, [W3C status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) for accessible feedback, and [Supabase sign-out semantics](https://supabase.com/docs/guides/auth/signout) for session scope and token expiry. These are implementation references, not a claim of independent certification.

Further enterprise capabilities require full product workflows: MFA enrollment/challenge/recovery, a device inventory, central administrative audit history, notification delivery preferences, and time-zone/date preferences applied to all consumers. Default-mailbox switching still needs a transaction across its reset and save writes. The current unsaved-edit guard covers links and reload/close; browser Back/Forward and programmatic navigation need router-level handling. Inactive switches for these capabilities were not added.

The [7 November benchmark](settings-benchmark-2026-11-07.md) and the notes below describe earlier versions; their start-page and previous verification claims are historical.

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
