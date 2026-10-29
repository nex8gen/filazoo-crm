# Tasks and notifications audit — 29 October 2026

The feature was partially working. Tasks and flow alerts were saved and scoped to their recipients, but several lifecycle and usability gaps prevented reliable follow-through. Those gaps are now fixed in the workspace, and the database migration is applied to the connected CRM.

## Connected CRM workflows

| Workflow | Expected behavior after the application release |
| --- | --- |
| Personal tasks | Create, edit, reschedule, complete or cancel your own tasks from Tasks and notifications. Retrying creation uses the same ID; edits check the saved revision. |
| Company / pipeline follow-ups | Scheduling creates an account-owner task. Rescheduling from the task updates the company's next follow-up date. Completing or cancelling the current follow-up clears that date without recreating the task on later stage changes. |
| Company purchase analysis | Product follow-ups stay linked to their analysis record. Account-owner changes transfer the open follow-up to the new owner. |
| Automation flows | Create-task and internal-alert steps continue to work. Tasks configured for the account owner follow subsequent owner changes; explicit teammate assignments stay with that teammate. Read-only viewers cannot be chosen for new flow tasks. |
| AI email / invoice handoffs | Shipping approvals and AI review tasks retain their dedicated controls. Ordinary editing/completion cannot bypass an active AI review. Handoff notifications link to the review task and become read when the task is resolved or cancelled. |
| Assignment and due dates | New assignments create in-app alerts. A database job checks due tasks every minute and creates one reminder per task, due time and recipient. Rescheduling retires the old due reminder; closing a task retires its linked unread alerts. |
| Ownership and member removal | Account-owner follow-ups transfer with the company. Existing member-removal redistribution remains in place. Unassigned work has no notification recipient until it is assigned. |
| Notification bell | Counts all assigned open tasks plus unread alerts. Updates after task/company/AI actions, on focus and visibility changes, and through polling. |

Incoming email, Shopify leads and Meta enquiries can create work through their configured automation flows. This feature does not automatically alert on every incoming message, invoice payment, overdue invoice or inventory change. Email delivery remains controlled by an explicitly configured email-alert flow; new assignment and due reminders are in-app notifications.

## Problems corrected

- Due dates were stored without any scheduled due-notification producer.
- Completing a scheduled follow-up left the company's `next_followup_at` behind; later pipeline updates could recreate the work.
- Product and owner-based flow tasks did not follow ordinary account-owner reassignment.
- Older unread alerts and tasks beyond the first 100 records were inaccessible.
- Background refreshes could overlap and restore stale state after a write; failures were silently hidden.
- Several company and AI actions left the bell count stale.
- Read-only task mutation, cancelled-task completion, and stale-edit handling were inconsistent across entry points.
- AI handoff alerts lacked task references, so resolving the work did not clear those unread alerts.
- The task page had no direct task creation/editing/cancellation controls or navigation entry.

## Verification

- `npm run verify` passed: ESLint, all **744 tests**, the production build and client bundle checks.
- Added route tests for authentication, cross-origin requests, read-only roles, input validation, retry-safe IDs, revisions, pagination and safe error responses.
- Expanded activity tests for recipient isolation, pagination beyond 100 rows, unread ordering, off-page/closed-task links and cancelled-task protection.
- Added task-service checks protecting company/product linkage markers and scheduled follow-up dates.
- Ran `tests/task-notifications-database.sql` and `tests/email-auto-reply-database.sql` against the connected database inside rollback transactions. Assignment, due deduplication, rescheduling, completion, cancellation, owner transfer, duplicate cleanup, AI handoff links and server-only privileges passed. All fixtures were rolled back.
- Applied `supabase/migrations/20261029030331_task_notification_lifecycle.sql`; local migration naming matches the recorded remote version.
- Confirmed `filazoo-task-due-reminders` is active on `* * * * *`; its actual scheduled run succeeded.
- Supabase security advisors returned the same findings as before the migration. No new findings were introduced. Activity tables remain inaccessible to browser database roles; new functions use invoker security and restricted execute grants.
- Added Simplified Chinese copy and passed the repository's translation coverage check.

## Release status

Database changes and the reminder scheduler are live. The application changes are built and verified locally. A read-only browser check of the production Tasks page still showed the previous screen, so the new task controls and revised activity API have not been verified in a deployed browser session. No application deployment was performed as part of this audit; the workspace also contains unrelated work in progress.

The new activity API and its UI must be deployed together: task edits require the saved revision and an explicit change set. The database migration is additive and compatible with the previous application.
