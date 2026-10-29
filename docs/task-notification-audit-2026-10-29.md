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
| Notification bell | The badge counts unread notifications once. The activity panel separately previews open tasks and notifications. Updates after task/company/AI actions, on focus and visibility changes, and through polling. |

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

## UI refresh

Replaced the two-column task/alert cards with a focused work inbox. The page now has an actionable overview, separate task and notification views, urgency groups, a completed-task view, server-side search and filters, compact task actions, and more useful empty states. Internal follow-up linkage markers are presented as readable source labels.

The header bell opens an activity panel with task previews, notification previews, separate counts, mark-read actions and links to the full inbox. Its detailed content loads on opening and is limited to five records per list. AI review controls load only when a full managed task requires them.

The task editor has clearer fields and responsive spacing. Browser testing found and corrected a save button that used the component library's default `type="button"`; it now explicitly submits its form. Editing an unchanged due time also preserves the original stored seconds instead of silently rounding to the minute.

Verification for the UI refresh:

- `npm run verify` passed: **795 tests**, lint, production build and bundle budgets.
- Real task and alert reads against the connected CRM passed for preview counts, completed/unread filters and literal search characters. These checks did not write CRM records.
- An isolated browser preview using the production UI components and synthetic data verified empty/populated lists, header previews, mark-read count synchronization, completed views and successful task creation.
- Checked desktop, 390 × 844 mobile, short 390 × 600 mobile, and dark mode. The header panel stayed within the viewport and the task editor remained scrollable on the short screen.
- Added regression coverage for submit controls, exact due-time preservation, revision handling, retry IDs, source labels, timezone boundaries, global filtering and bounded preview payloads.

These application changes are ready locally; this UI refresh did not perform an application deployment.

## Task assignment and layout corrections

Removed the marked workspace/date line, subtitle and four summary cards. Customer reply tracking now lives in a tab within the work inbox. The page toolbar stacks within narrower content areas, and all three tabs fit on mobile. The bell's unread count sits inside its button, so task totals cannot inflate the notification number or push the badge outside its border.

The task editor now has a searchable workspace-user picker. Eligible assignees are activated admins, operators and business development managers. New tasks record their creator and assigner; the Assigned by me view keeps delegated and subsequently unassigned work discoverable. Only the assignee, creator or last assigner can access an individual task through these controls. Read-only users cannot mutate tasks or retrieve the assignment directory. Company-owned follow-ups remain tied to the account owner, and active AI reviews retain their dedicated controls. Unchanged long system evidence is preserved when editing other task fields.

Assignment validation is enforced by both the service and database. Completing delegated work sends one completion notification to its assigner. Applied `20261029071433_task_team_assignment.sql`; the change is additive and the new trigger functions retain invoker security and restricted grants.

A production read found an older activity response without the new filter and assignment metadata; the screenshot's transient refresh failure was not reproduced during that read. The revised interface uses the dedicated `/api/tasks` endpoint and validates the saved recipient before reporting assignment success. Refresh errors retain the last available work and offer retry; missing legacy timestamps no longer use an artificial fixed date.

Final verification:

- `npm run verify` passed: **804 tests**, lint, production build and bundle checks.
- Task assignment, notification lifecycle and AI auto-reply SQL regression checks passed against the connected database using rollback transactions.
- Real activity and assignment-directory reads passed without modifying CRM records.
- Browser checks with production components and synthetic records verified teammate assignment, delegated-task visibility, searchable-picker keyboard focus, integrated customer replies, contained bell counts and responsive layouts.
- Security advisors returned the same findings as before this migration; no new findings were introduced.

The database changes are applied. Application changes are verified locally and still require a deployment; this work did not deploy the unrelated changes also present in the workspace.
