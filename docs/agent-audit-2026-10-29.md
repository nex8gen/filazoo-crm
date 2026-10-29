# Published CRM agent audit — 29 October 2026

Site: https://crm.filazoosupply.com

Follow-up: [agent improvements and additional action checks](agent-improvements-2026-10-29.md) covers the later release. Its new task, download, CSV, conversation-AI and approved-knowledge tools supersede the corresponding limits in this initial audit.

This audit includes real approved actions on labeled synthetic production records, isolated execution tests at authenticated service boundaries, schema/authorization/failure tests, and inspection of CRM features that lack agent tools. It does not certify every possible model response or claim that mocked delivery is a real email send.

## Confirmed weaknesses and changes

| Finding | Evidence | Change |
| --- | --- | --- |
| Failed multi-step customer update | After creating the test company, the agent combined a customer lookup and mutation output; production returned “Prepare one read at a time, without mutation proposals.” | Discard invalid output and allow one bounded re-planning attempt. Reads still finish before proposals are stored. Repeated invalid output stops without actions. |
| Claimed completion before approval | Invoice creation/correction and catalog requests said they were already created/updated while approval buttons were still visible. | The server controls proposal status text. Completion is reported by the execution endpoint after the shared CRM service succeeds. |
| Denied saved audiences exist | The agent said there was no separate database of saved segments; the CRM has `company_segments` and `/segments`. | Added bounded segment reads and validated create/update actions through the existing CRM service. Instructions distinguish saved audiences from a customer's business-segment label. |
| No ERP inventory tools | The agent correctly reported it could not inspect stock snapshots or start a sync. | Added snapshot/status reads with CRM-to-ERP SKU alias resolution, freshness/coverage and configured-warehouse scope. Added explicit, manually approved inventory sync for admin/operator users. |
| Catalog approval was difficult to review | A one-product approval exposed thousands of characters of URL-encoded `variant-json` and internal price tags. | Approval now shows readable product names, variants and quantity prices. The full server snapshot remains part of stale-record validation. |
| Created customer/order identity lost | The shared creation services returned success text without the new saved ID. Dependent work needed to rediscover the record. | Customer and purchase-order creation now return their saved IDs. Agent results include those IDs; the customer result opens the exact new profile. |
| Overconfident capability descriptions | Absence of a tool was treated as absence of a CRM feature. | Instructions now state actual tool coverage, give interface paths for remaining features and prohibit claims of permanent learning or unrequested background work. |
| Local live-model evaluation blocked | All 12 baseline synthetic provider evaluations failed with “API key not valid.” Production product/invoice/action requests worked. | Reported separately from agent capability failures. No credentials were changed or copied from production. The reusable provider evaluation was expanded to 18 cases. |

## Production action checks

Synthetic company: [AI AUDIT 20261029 DO NOT CONTACT](https://crm.filazoosupply.com/companies/dbe22b72-e614-420d-a6ed-cdf8128f4030). No contact email was added.

| Action | Observed result |
| --- | --- |
| Create company | Saved name, country, Boston city and business segment. |
| Update profile | Saved shipping recipient/address/phone, quantity 200 and Qualified interest stage. Reloaded profile showed these fields; billing stayed empty. |
| Append note | Execution returned “Comment posted.” |
| Create catalog-price invoice | Created draft `INV-000037`: 10 Black PLA-BASIC at $5.31, $12 shipping, $5 discount, $60.10 total. |
| Correct invoice | Saved shipping $15.50, retained 10 units, price and discount; resulting total $63.60. |
| Create customer catalog | Saved v1 for only PLA-BASIC; execution confirmed its PDF ready for preview/download. |
| Create purchase order | Saved draft `AI-AUDIT-PO-20261029`, 4 AUDIT-PART at the explicitly supplied $2.50/unit, with saved shipping defaults. |
| Create automation | Saved `AI AUDIT 20261029 INACTIVE` as a draft: United States new lead → wait 5 minutes → stop. Never activated. |

## Post-release checks

| Check | Observed result |
| --- | --- |
| Create saved audience | Created `AI AUDIT 20261029 ONLY` with only the synthetic company's ID. The customer's business segment was unchanged. |
| Edit saved audience | Looked up and renamed it to `AI AUDIT 20261029 VERIFIED`; selected company and description were preserved. |
| ERP lookup | Verified production reports `configured: false`; no stock snapshot exists. No sync was started and no stock was invented. A real sync still requires an ERP connection. |
| Create inactive product | Saved `AI-AUDIT-20261029`, one White variant at $2.50, inactive. |
| Edit inactive product | Found it despite the active-product context filter and renamed it `AI AUDIT VERIFIED DO NOT SELL`; tier, variant SKU/price, stock labels, lead time and inactive state were preserved. |
| Correct pending-action status | Segment/product/invoice proposals displayed the server's “ready for review” text, without claiming completion. |
| Readable catalog approval | New approval displayed $5.31/$5.00/$4.79 quantity tiers and named variants; no encoded internal tags appeared. The duplicate proposal was declined. |
| Draft email | Prepared the exact authorized recipient/subject/body and opened the actual inbox composer without sending from draft approval. |
| Plain email | Sent from the composer through the configured mailbox; visible in Sent to `souravmallick@qq.com`. |
| PDF send through agent | Approved the agent's `send_invoice` action to the same test recipient. Generated the actual PDF, sent once, kept the invoice a draft and persisted a Sent record. Independently opened that Sent message and verified its `INV-000037-DRAFT.pdf` attachment (58 KB). |
| Invoice read-back | Independent invoice page showed 10 Black PLA at $5.31, $15.50 shipping, $5 discount, $63.60 total and Draft status. |

The user explicitly authorized `souravmallick@qq.com` for live email tests and then confirmed **both messages arrived and the PDF opens**. Subjects were `[Filazoo AI audit 20261029] Plain email test` and `[Filazoo AI audit 20261029] PDF attachment test`. Before the PDF send, only the synthetic invoice's saved payment methods were removed and its note was set to `TEST ONLY - synthetic AI agent audit, not a payable order`; workspace payment settings were unchanged. No other customer received test mail.

Screenshot evidence: `output/agent-audit-email-verified.jpg`.

## Execution coverage and boundaries

The implementation exposes 8 original action types and 29 `crm_action` operations. Isolated tests execute actions through the same agent preparation/execution code and assert calls, arguments, unchanged fields, ownership, stale snapshots, error propagation and review behavior. External service boundaries are replaced with synthetic fixtures; these tests do not send customer messages or change real permissions.

| Area | Covered execution behavior |
| --- | --- |
| Customers | Create/update/note, saved IDs, follow-up scheduling/cancellation, owner assignment, deletion dispatch and role restrictions. |
| Products/catalogs | Product create/edit with variants/tier preservation, readable catalog approval, catalog selection and actual PDF attachment bytes in renderer tests. |
| Orders/invoices | New/partial order saves, linked-order invoice pricing, custom lines, create/update invoice, issue/void/delete, receipt recording, integer-cent amounts and revision locks. |
| Email/messaging | Draft versus send, verified recipients/threading, selected mailbox, source access, email organization, draft composer, social channel routing and delivery-error behavior. |
| Flows | Create/edit/status/duplicate/delete, ordered definitions, owner scope and activation validation. |
| Tasks/settings | Own task/alert completion, preferences, profile, team/mailbox actions, invoice defaults/payment methods, omitted-field preservation. |
| New tools | Segment creation/update/staleness/validation; inventory SKU resolution, configured scope, role/manual approval, unavailable ERP and sync failures. |
| Agent protocol | Read-only Chat, one bounded repair, read budgets, no premature writes, approval/expiry/decline, concurrent execution and incomplete-send outcomes. |

The isolated release passed **699 tests**, ESLint and TypeScript after `next typegen`; Vercel built it successfully. Final focused agent verification passed **68 tests**. The final shared working tree passed **715 tests** and TypeScript, with lint and a production build also passing during the audit. Its larger count includes unrelated in-progress history work, which was excluded from this release. A post-release error/fatal runtime-log scan returned no entries for the audited deployment in the inspected window.

## Remaining limits

| Task/feature | Current limit and supported route |
| --- | --- |
| CSV exports or initiating PDF downloads | Agent can save catalogs and prepare invoice/catalog attachments; direct export/download commands still require `/companies`, invoice or catalog controls. |
| Per-conversation AI auto-reply controls and knowledge editing | Existing `/emails` interface is required. Creating an automation flow with an AI reply step is a separate supported action. |
| ERP connection configuration | Credentials, warehouse selection, mappings and schedule configuration remain under Settings. Stock reads/sync do not configure a connection. |
| Warehouse-by-warehouse stock breakdown | Current saved ERP quantities aggregate the configured warehouses. They must not be presented as individual warehouse totals. |
| Account login, passwords, OAuth, connecting providers | Interactive setup remains required. The agent must not request credentials in chat or bypass authorization. |
| Uploading files/images and specific catalog subsets in email | User file selection/uploads and the inbox catalog picker remain interactive; a complete active-product catalog attachment is supported. |
| Customer portal access settings, standalone general tasks, saved dashboard layout changes and account-level integration administration | No dedicated agent actions currently expose these UI controls. Product-specific purchase-analysis follow-ups are also separate from generic company follow-up scheduling. |
| Whole-database analytics and unlimited bulk work | Reads are bounded to four per request, including at most two email lookups; incomplete coverage must be stated. The agent must not calculate purported complete totals from a partial page. |
| Dependent multi-step work | Newly created IDs can be reused on the next user turn. There is no autonomous post-approval continuation engine. Conflicting same-record proposals can become stale after another write and need re-planning. |
| Permanent self-training or new database fields | Instructions/tools are changed in code; conversation alone does not add tools, modify schema, fine-tune the model or grant lasting authorization. |
| Financial/destructive/admin actions | Tools remain role restricted and manually reviewed. Payments record an existing receipt; they do not charge a card or move money. These were not performed on real business records during the audit. |

## Reproduction

```powershell
npm.cmd test
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd run build
node --env-file=.env.local --experimental-strip-types scripts/verify-agent-crm-tools.ts
```

The final command requires a valid local provider key. It uses synthetic records and never prepares stored proposals or executes mutations. Production verification uses the signed-in browser with manual approval. Test data is labeled and retained for review. The synthetic invoice remains a draft, the product is inactive, and the automation was never activated. Only the two explicitly authorized test emails were sent.

## Release

Base: `862bc22a8997de793db8a3e8cbf27744b5922c2d`, matching the production deployment when this audit began.

Release: `dpl_f7AqEfDgr7L2yWfJguLvdJLtxLco` — https://filazoo-obv6gqu6n-nex8gens-projects.vercel.app

The release was built from that base plus the audited action changes. Unrelated uncommitted email/history changes were preserved locally and excluded. Staged `/api/health` returned HTTP 200 with `database: connected`; the existing live-sending configuration was preserved. Production promotion was verified against the custom domain.
