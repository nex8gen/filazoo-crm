# Actionable CRM tasks

Tasks can carry prepared work and execute its next step. A notification and its task open the same work panel. Button behavior is driven by saved workflow metadata, rather than inferred from task-title keywords.

## Supported recipes

| Recipe | What the employee can do |
| --- | --- |
| Invoice review | Inspect current line items, preview/download the PDF, edit the invoice, confirm shipping, review the outgoing email, and send the PDF. Admins/operators can explicitly choose to issue it before sending. |
| Email follow-up | Review/edit a prepared message, send it using an available mailbox, or move the reminder to tomorrow. |
| Customer details | Review suggested billing/shipping/VAT details against the original reply, edit them, merge them into the customer profile, and finish the review or send a reply. |
| Payment follow-up | Review a reminder based on the linked issued invoice's outstanding balance and send it. Paid, void and draft invoices cannot trigger a payment reminder. |
| Reply review | Read the source reply, edit/send the next response, or finish a review that requires no email. |

These recipes are the implemented set, not a claim that every possible CRM operation is supported. They can be combined with existing customer-information requests, waiting periods, assignment, priorities and due dates. More action types should be added to the validated workflow schema and executor; arbitrary URLs, executable code and arbitrary JSON writes are not accepted.

## Shipping address to invoice

1. The AI agent resolves the actual customer and the agreed catalog items/variants/quantities.
2. It proposes `request_customer_information` (or watches a real sent email using `wait_for_customer_reply`) with `onReply: { kind: "invoice_review", items: [...] }`. A saved invoice can instead be supplied through `invoiceId`.
3. The existing request service sends the reviewed information request once and saves its RFC Message-ID.
4. A matching inbound human reply atomically completes the wait, creates one task and notification, and seeds a preparation job. Unrelated senders, unrelated threads, automatic replies and stale transitions are rejected.
5. The worker extracts suggestions from the newest reply above quoted history. Products, variants, MOQ and prices are resolved from current CRM records. Missing requested information blocks sending. Preparation creates a draft only.
6. The employee opens the task, previews the PDF, confirms the shipping cost (including explicitly approved free shipping), optionally saves customer details, and reviews the email.
7. The send action rechecks role, task and invoice revisions, current correspondence, recipient ownership, mailbox availability, suppression and unsubscribe state. It sends the exact invoice PDF using the durable email-send service.
8. SMTP acceptance is recorded before workflow/task completion. Completion marks the task's notifications read. Uncertain delivery is held for reconciliation rather than automatically resent.

## Runtime and recovery

- Schema: `crm_task_workflows`, `crm_task_workflow_events`, `agent_reply_requests.on_reply` and guarded RPCs. Both new tables use RLS and deny direct anonymous/authenticated access; authenticated server routes perform authorization.
- Entry points: `/api/tasks/[id]/work` GET/POST, `/tasks`, and the header notification panel.
- The customer-reply cron now also drains bounded workflow preparation jobs. **Continuous background preparation requires the updated application/cron code to be deployed**; applying the schema alone does not update a running deployed worker. The local work panel can explicitly run preparation through “Prepare now.”
- Job claims use row locking, `SKIP LOCKED`, a lease and revisions. A deterministic invoice identity prevents duplicate drafts after interrupted preparation.
- Inbox reads fetch only workflow summaries in one batch. Full evidence and documents load when the work panel opens. PDF rendering runs only on preview/download/send. Task notes retain a short excerpt; the full request context stays on the request/workflow.
- Editing a safely failed draft clears its old send identity. Possibly accepted sends remain held. “Check delivery status” reconciles a saved successful send without transmitting again.
- Updating customer details compares the target fields with their preparation baseline inside a transaction and merges only approved fields. Unrelated billing data is preserved.

## Validation

- Focused schema, authorization, action execution, stale revision, uncertain delivery, safe retry, source grounding and paid-invoice tests live in `tests/task-workflow*.test.ts`.
- `tests/task-workflows-database.sql` checks the real schema inside a rolled-back transaction: atomic handoff, notification deduplication, exclusive preparation, nonmember/stale-action rejection, profile merge, task completion and audit history.
- `scripts/task-workflows-preflight.ts` is read-only and checks the configured QA mailbox and current catalog.
- `scripts/verify-task-workflows.ts --live`, run through `scripts/run-task-verification.cjs`, is the separately approved live test. It confines messages to the connected owned mailbox, labels QA records, watches actual SMTP/IMAP, checks draft PDF receipt and duplicate prevention, and saves evidence under `docs/audit-evidence/`. Its checkpoint prevents automatic retransmission after interruption.
- The user explicitly approved the three QA messages, the private temporary Vercel sandbox with its required credentials, and a local browser session. Live SMTP/IMAP delivery passed, with one notification for the original handoff, task completion, read-state propagation and duplicate-send rejection. The invoice remained a draft. Follow-up preparation and customer-detail merging/completion also passed against the real database.
- A self-message is correctly classified outbound. This test therefore used its actual received headers/body at an explicitly synthetic handoff boundary; it does **not** prove automatic external inbound matching in a live mailbox. Production matching was not weakened. Matching and transactional handoff have separate automated/database tests.
- Live AI preparation exposed malformed field types and a constrained-decoder complexity limit. The worker now supplies an explicit structural response schema, requires each extraction field (empty when absent), validates the full bounded schema on the server, and normalizes escaped address line breaks before checking literal evidence.
- Final document review caught a country-only billing fallback in the initial QA PDF. `verify-task-billing-regression.ts` proved the correction with real AI and database preparation, with no further email: full billing and shipping addresses, original thread subject, ignored quoted history and unconfirmed shipping. The original saved draft was corrected without resending. Country/city fallbacks now block sending. The corrected one-page PDF was rendered and visually checked.
- Evidence: `docs/audit-evidence/task-workflows-live-20261030.json`; desktop/mobile screenshots beside it. The temporary sandbox was stopped and removed. QA company/tasks/drafts remain labelled for inspection. No production application deployment was performed.
- Browser verification showed the actual PDF inside the task. Preview fetches a PDF only when opened, reports loading/errors, uses a temporary object URL and revokes it on close. The work dialog fit a 390-pixel viewport without horizontal overflow.
- The follow-up `task_workflow_legacy_review_compatibility` migration was **explicitly approved and applied**. It preserves the old deployed interface's Complete button only for untouched plain reviews from older requests with no explicit workflow, preparation, lease or delivery attempt. Real database rollback tests passed for legacy completion and rejection of explicit, prepared, leased, ready, sending and uncertain work. Function permissions and account authorization remain unchanged. Application rollout remains separate.
- Production build, TypeScript and changed-file lint passed. The final full-suite run passed all **1,014 tests**, including the address/schema regressions and translation coverage. Logs: `tmp/task-workflows-tests-final.log`, `tmp/task-workflows-types.log` and `tmp/task-workflows-build-final.log`.

## Research

The design combines record-linked tasks and follow-up queues with required inputs and explicit workflow transitions. Reference patterns: [HubSpot tasks](https://knowledge.hubspot.com/tasks/create-tasks), [Zoho workflow blueprints](https://www.zoho.com/uk/billing/help/settings/custom-modules/blueprints.html), and [Salesforce approval work items](https://developer.salesforce.com/docs/platform/data-models/guide/platform-flow-approval-process.html).
