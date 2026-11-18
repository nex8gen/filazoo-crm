# Sales automation and daily work improvements

The CRM now includes the remaining PRD capabilities in the existing workflow, email, library and Home interfaces. New automation recipes start as drafts; this implementation does not activate or replace saved live workflows.

## Inactive customers

Choose **Workflow → Create workflow → Reactivate inactive customers**. The trigger finds customers assigned to the workflow owner who have a shared quotation or previous order and no human contact or order within the configured number of calendar months. Open orders, future manual follow-ups, suppressed addresses and active conversation automations are excluded.

The default sequence sends at months 1, 3, 6 and 12 after enrollment. Each wait is an editable calendar-month milestone anchored to entry, so old customers do not receive catch-up messages in quick succession. The inactivity baseline is saved separately from message timestamps. Automated workflow emails do not refresh human activity.

The scheduler checks eligibility during waits and again immediately before delivery. Replies, orders, account reassignment or manual takeover stop the cycle. The existing delivery receipts, sending limits, unsubscribe checks and SMTP uncertainty handling remain in effect. A database constraint prevents two simultaneous inactive-customer cycles for one company. Email follow-up filters show the actual workflow enrollment, next scheduled action, progress and paused states.

## New inquiries

Choose **Workflow → Create workflow → New lead auto-response**. General inquiries receive the editable company introduction and a catalog. Specific inquiries receive AI questions for missing requirements and a focused catalog. Prices are disabled. Customer refusals and unavailable products do not become invented attachments.

The preset waits one minute before responding and creates a personal handoff task plus an in-app notification the next business morning at 09:00 China time. Existing schedules remain editable. An atomic response claim prevents overlapping new-lead flows from sending duplicate initial responses, including when the incoming-email trigger matches the same inquiry.

## Daily work and reusable content

Home groups real open tasks by urgency and saved priority, with links to task details and the existing editor for scheduling or delegation. Required workflow steps cannot be bypassed using the completion checkbox. Read-only members cannot modify tasks. The first 100 tasks are shown with an explicit link to the full list.

The marketing designer accepts clipboard image files and copied image HTML. GIF bytes are preserved through the existing image upload path and templates remain reusable. Existing image size and format limits apply.

**Find with AI** is available in Files & templates and the email library picker. It searches authorized library metadata, selects only existing results, and uses the existing file/template insertion path. Searching never sends email. Mixed-library AI searches require the workspace's applicable customer, email, product, financial and business-knowledge data permissions.

## Verification

- Unit and component tests: `npm run test`.
- Static checks: `npm run lint` and `npx tsc --noEmit --incremental false`.
- Build and payload checks: `npm run build` and `npm run perf:bundles`.
- Rollback-only database checks: `tests/sales-automation-database.sql`.
- Authenticated, non-sending API checks: `node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/verify-sales-automation.ts --ai`.

The native browser connection was unavailable during implementation. Component interactions, API responses, database behavior and build output were checked; a rendered desktop/mobile visual review remains necessary.
