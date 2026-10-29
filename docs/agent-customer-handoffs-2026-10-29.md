# Customer information and reply handoffs

The agent previously had disconnected tools for email, invoices and tasks. A task saying “wait for the customer” did not actually monitor incoming mail or preserve a continuation. Customer history searches also covered only the default mailbox.

## Implemented behavior

1. Identify the customer from the selected page, actual email or an unambiguous lookup. Ask which customer when identity is unresolved.
2. Read saved details. Ask for a missing full shipping/billing address and shipping charge. City/country is not a delivery address; a default zero charge does not confirm free shipping.
3. When asked, search access-filtered incoming customer emails across up to eight accessible mailboxes. Report pagination, unavailable bodies, omitted mailboxes and lack of live synchronization. An incomplete search does not prove an address was never supplied.
4. With an explicit customer-outreach request, prepare one reviewed `request_customer_information` action. Preview recipient, sender, email body, requested information, next task and waiting period before sending.
5. Save the request before SMTP, use a stable outgoing Message-ID, save the Sent receipt and arm a durable one-shot wait. An active scope prevents another equivalent send even if task wording changes.
6. The minute worker checks the actual recipient and RFC reply headers. A matching human reply atomically creates one assigned task and one in-app notification. Preserve requested information, historical invoice/proposal context, reply evidence and links.
7. The user reviews the actual reply, confirms missing details and current prices, then creates/updates and sends the invoice through existing reviewed actions.

This changes application tools, instructions and durable state; it does not fine-tune the underlying model or grant new account permissions.

## Reusable cases

| Missing input | Request | Task after reply |
| --- | --- | --- |
| Delivery address | Full address, recipient and phone | Verify details, confirm freight, finish invoice |
| Billing or VAT information | Billing address/company tax ID | Review evidence, update profile and draft invoice |
| Products or quantity | Confirm actual catalog variants and quantities | Check current prices, prepare quotation/invoice |
| Purchase order | Ask for PO reference/document | Review attachment and enter/check order |
| Artwork/sample approval | Ask for explicit approval or revisions | Review response and continue production planning |
| Other customer clarification | State the precise missing information | Review response and perform the specified next work |

`wait_for_customer_reply` can watch an actual existing Sent email without resending it. `cancel_reply_request` stops an owned active wait. Status and cancellation are available under **Tasks → Waiting on customers**.

## Failure handling and limits

- Ignore outgoing messages, demonstrations, automatic/OOO responses, unrelated senders, missing/wrong thread headers and messages outside the waiting window.
- A reply is a review trigger, not proof that an address, price or approval is complete. Customer email text is evidence, not application instructions.
- Requests watch only new replies after approval. Replies without preserved RFC threading need manual review; subject similarity is insufficient.
- Expiry creates a follow-up task. This workflow does not send reminder emails or automatically issue/send invoices.
- Ambiguous SMTP outcomes create a delivery-review task and are never automatically resent. Interrupted sends recover only from an actual saved Sent receipt.
- Recheck active membership, Auth suspension, original role, mailbox access, current contact and BD assignment. Fail closed when access changes or verification is unavailable.
- Polling is bounded to 50 eligible waits per run and a three-minute budget. It syncs each watched mailbox once per run and uses the existing shared mailbox lease. Provider errors, queues and mailbox traffic can delay detection.
- Historical invoice snapshots are planning context, not current pricing or permission to execute an expired proposal. Long snapshots/replies are explicitly marked truncated.
- Direct browser database access and RPC execution are revoked. Owner-filtered server APIs expose a bounded metadata projection without mailbox credentials.

## Validation

- Isolated release: 778 passing tests, lint and TypeScript checks; production compilation succeeded. An earlier shared working-tree check passed 798 tests and TypeScript checks. A later shared-tree run, after concurrent task-assignment changes appeared, passed 780 of 799 tests with 19 failures (including unresolved `task-assignees` fixture imports and activity expectations). Those concurrent changes were excluded from the deployed isolated release; they were not modified as part of this workflow.
- New service fixtures cover save-before-send, duplicate prevention despite wording changes, database refusal before SMTP, ambiguous delivery, watch-without-resend, cancellation, reply detection, expiry, suspended owner and unavailable mailbox.
- Transactional integration tests run as `service_role` against the actual database and roll back fixtures. They verify strict evidence validation, owner identity, idempotent task/notification creation, cancellation, expiry, uncertain delivery and removed-mailbox blocking.
- Actual grant checks: RLS enabled; anonymous/authenticated table access and authenticated finish-RPC execution denied; service worker execution allowed.
- A regression exercises the actual session middleware and cron handler: no staff session redirect for the exact worker path; missing/wrong bearer credentials return 401; authorized health checks do not process mail.
- Invoice email intent is grounded in user messages before SMTP validation and proposal saving. Draft-only/new invoice requests cannot inherit an old send instruction or acquire a provider-invented send. Service fixtures verify draft creation with zero email calls, and a live retest showed an invoice-only review card.

The JavaScript budget check found an existing performance gap on Email and Pipeline. A same-environment build of the prior published source was already over the 420,000-byte gzip budget: Email 473,705 bytes and Pipeline 444,948 bytes. The workflow build measured 474,095 and 445,346 bytes respectively (approximately 0.4 KB growth); other measured pages stayed within budget. This does not establish runtime response latency. Further deferred loading of the existing Email and Pipeline interfaces remains separate work.

## Live verification, 29 October 2026 (UTC+8)

- Published at `https://crm.filazoosupply.com` from the isolated release `.vercel/customer-reply-release-20261029`. Final deployment: `dpl_6JvHukP52S2A9MZGMgbZq2MBFZqj`. No unrelated workspace product/order/task-assignment changes were included.
- Created synthetic customer `faa6fe6a-ed92-4ab2-a2cd-e458da93d1dc`, **AI AUDIT REPLY HANDOFF 20261029 TEST ONLY**, using the user-authorized test address `souravmallick@qq.com`. Both saved addresses were empty.
- The original misspelled bare invoice request produced a question for products/quantities. An unavailable Black Gold variant produced a question listing actual saved variants. Choosing Red Gold preserved 100 pieces at the current saved $5.66 price.
- “Add the address and shipping cost” produced a missing-address question and requested a shipping charge, without inventing an address or confirming free shipping.
- History search reported its coverage. Live testing found its unloaded-body count included other customers; this was corrected to count only accessible messages for the selected customer/search.
- Sent exactly one request email with subject **[Filazoo AI audit 20261029] Shipping address reply test**. Request/action ID `c74d59c8-e1eb-449e-a9a1-ecde1540c72b`; saved Sent receipt and stable RFC Message-ID confirmed.
- The user replied from QQ and confirmed “replied.” Incoming timestamp: **14:45:31**. The background minute worker detected it at **14:46:06**, approximately 36 seconds later, without a manual processing invocation. HTTP worker result: `200 {"ok":true,"checked":1,"completed":1,"errors":0}`.
- Task `c74d59c8-e1eb-449e-a9a1-ecde1540c72b` was assigned to the requesting user with the 100-piece Red Gold invoice plan, actual reply evidence and instructions to confirm shipping before preparing/sending the invoice. The email link opened the actual two-message QQ thread.
- First live detection exposed an existing task-assignment trigger producing an additional alert. Follow-up migration `20261029064755_agent_reply_notification_dedup.sql` reuses that alert atomically. Integration tests now count **all** notifications for the task, not just a predetermined ID. Removed only the duplicate synthetic audit alert; the reply notification and task were retained.
- Final database evidence: status **received**, **1 task**, **1 notification**, **1 request Sent copy**, **0 invoices** for the synthetic customer. The successful invoice-only regression proposal was declined without creating a test invoice or sending another email.
- QQ plain-text evidence contained HTML entities and excess blank lines. New handoff evidence decodes common entities as plain text, retains the untrusted-evidence label and never renders it as HTML. The synthetic task's formatting was repaired without changing its facts.
- The background schedule is active every minute. An authenticated worker health request using the existing Vault-held credential returned `customer-replies-v1`. Anonymous requests are denied. No mailbox credentials were changed or exposed.

Proof: [published task and notification](audit-evidence/customer-reply-task-20261029.png).

The live email reader initially displayed **Unknown company** even though server-side enrichment correctly resolved the saved customer. Fixed `getEmailInboxBackendData` to use the matched saved company name for received and sent messages. A regression covers both directions, and reloading the published QQ thread showed **AI AUDIT REPLY HANDOFF 20261029 TEST ONLY**. The test did not enable general auto-replies or establish that every CRM workflow is supported.
