# New lead: AI reply, reminder and personal handoff

The owner requested a one-minute initial delay, an AI response, a task assigned directly to them when the customer replies, and an AI reminder when the customer does not reply. The owner selected a **24-hour** reply window.

## Starter in the workflow builder

Choose **New workflow → AI lead reply and personal handoff** in `/workflow`. This opens an editable, unsaved draft. The starter picker passes the signed-in member's ID into every handoff task and notification, so these go to the person creating the draft even if the lead belongs to a different account manager. The saved assignment remains that specific member until explicitly edited.

1. **New lead** enters once.
2. **Wait one minute.** Weekends and business-hour restrictions do not extend this configured delay. Actual sending depends on the next scheduler tick and AI/SMTP processing time.
3. **Check for an early customer reply.** If the customer already replied, create the personal task, notify its assignee with a customer-context link, and stop before the introduction.
4. Otherwise **send an AI introduction** using the latest authorized conversation and active products. The starter does not quote prices or attach a broad catalog by default; these remain editable options.
5. **Wait 24 hours**, then split on **Customer replied**:
   - **Yes:** create a high-priority task due today, assigned to the member who created the draft; send that member an in-app notification with a customer-context link; **Stop**.
   - **No:** send **one AI-generated reminder** in the same conversation. Its message filter rechecks that the customer has not replied when the reminder action starts.
6. **Wait another 24 hours**, then check again. A reply creates the same personal handoff and ends automation. No reply ends the workflow without another email.

The task must precede Stop inside the reply path. Stop ends execution, so a task placed after it would never run. The no-reply route is a separate branch; it cannot fall through into the reply task.

## Timing boundary

This is a timed-check starter: it checks after the one-minute and 24-hour waits. A customer replying during a 24-hour wait gets the task when that wait ends, rather than immediately on receipt. Immediate task creation requires a separate received-email handler tied to the enrolled conversation, with deduplication against the timed handoff; that connection is not added here. The existing general reply-review workflow should not be activated alongside this starter without deciding which flow owns task creation.

Reply conditions cover messages after the current run's last email and within its authorized thread. They rely on mailbox synchronization. The reminder filter runs when its action begins; it does not atomically exclude an inbound message arriving during AI generation or SMTP submission. Existing per-conversation AI automation, suppression, sender eligibility, budgets and sending limits continue to apply.

## Implementation and verification

- `lib/flow-recipes.ts`: new draft recipe with three reply branches, fresh action identities, one-minute first wait, 24-hour response waits, two maximum AI messages and task-before-stop ordering.
- `components/flow-starter-dialog.tsx` and `components/flow-builder.tsx`: use the authenticated builder viewer ID for personal assignment, without inventing or guessing a member ID.
- `lib/i18n.ts`: Chinese title and starter description.
- `tests/flow-runtime.test.ts`: run the real worker against isolated in-memory records with intercepted AI/SMTP. Cover replies before the introduction, after it, after the reminder, and no reply; verify exact initial delay, direct assignment despite a different company owner, notifications, termination and repeat-worker protection.
- Existing starter tests validate the definition and exercise generated branch coverage.

Full repository verification passed: ESLint, all **1,320 tests**, the production build with TypeScript, and every configured bundle budget. The build used the stable runtime output directory.

## Saved CRM draft

After the owner pointed out that the workflow was missing from the list, saved an actual CRM draft through the existing `save_automation_flow` function:

- Name: **New lead - AI reply 1 min - 24h reminder - assign to me**.
- Flow ID: `eb6e5319-7223-4b5b-a769-c22dd17893f7`.
- Creator and all personal task/alert recipients: **Sourav Mallick**, matched to the CRM's signed-in account menu and active administrator membership.
- Open locally: `http://localhost:3000/workflow?flow=eb6e5319-7223-4b5b-a769-c22dd17893f7`.
- Database read-back: saved steps/configuration exactly match the validated draft; status is `draft`; zero runs. The workspace workflow-list count increased from eight to nine.

Existing workflows are unchanged. The new workflow has not been activated and no real email was sent for this change. Native UI inspection identified the signed-in CRM account; no successful post-save visual check is claimed. Refresh the workflow list to retrieve the saved record.
