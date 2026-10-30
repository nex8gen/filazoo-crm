# Sales-stage feature retired — 30 October 2026

The CRM no longer presents or supports the sales pipeline. This supersedes the pipeline descriptions in earlier audits and setup documentation.

Removed from the application:

- Pipeline board, stage movement, opportunity creation, and stage/value/quantity controls.
- Analytics pipeline card, stage breakdown, cohort wins and estimated-value exports. Confirmed purchase orders provide the replacement summary metric.
- Company stage/status and estimated-order columns, sales-stage filters, and bulk stage changes.
- Segment stage summaries and the stage-based audience selector.
- Pipeline shortcuts in company menus and ownership settings; assignments are managed from company profiles.
- Sales-stage tools and estimates from AI profile updates, customer context, company CSV exports, automation capabilities, starters and editor controls.
- Sales-stage data queries from analytics and automation evaluation.

`/pipeline` redirects authenticated users to `/companies`, preserving old bookmarks without exposing a board.

## Backend compatibility and customer data

Account assignment, mailbox access and follow-up reminders historically share the `pipeline` table. Those internal storage relationships remain intact. The table and historical audit/migration records have not been dropped or rewritten. Customer records, owners, contact information, billing preferences, orders, invoices and reminders are preserved.

Current customer profile validation rejects sales stages, opportunity values, estimated order quantities and the former top-level opportunity currency. Billing currency remains available under customer commerce settings. New company creation only initializes the ownership record, without selecting a sales stage.

New or edited automation definitions containing sales-stage triggers, filters, actions or nested branch rules are rejected. Queued legacy definitions cancel before external actions. Unsupported audience rules match no companies until explicitly rebuilt; the editor offers an explicit removal action rather than silently widening the audience.

## Verification

- Browser: analytics shows confirmed orders and no pipeline section; companies show ownership and outreach without stage/estimate columns; old `/pipeline` links redirect to companies.
- Regression coverage: profile and AI validation, company exports, current automation capability schemas, nested retired-rule rejection, legacy queued-run cancellation, audience closure, ownership, follow-up reminders, billing, email access, segmentation, and analytics.
- Run `npm.cmd run verify` for the full suite, ESLint, production build, TypeScript and bundle budgets.

Final result: all 948 automated tests passed, along with ESLint, the production build/TypeScript checks, and every configured bundle budget. Live database checks confirmed all 218 companies and all 218 account assignments remained. One live automation with a retired stage filter was paused; it had no active runs. Read-back confirmed zero remaining live stage-dependent automations. No saved segments used sales-stage rules.
