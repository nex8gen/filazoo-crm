# CRM agent improvements — 29 October 2026

Follow-up to [the published-site audit](agent-audit-2026-10-29.md). This release addresses additional action gaps and defects discovered while extending the agent. The agent now exposes eight original action types and 37 CRM operations (45 named actions).

## Findings and implemented changes

| Weakness | Implemented solution | Verification |
| --- | --- | --- |
| Independent lookups required separate model rounds | Two to four independent CRM reads run concurrently in one round. Each counts toward the existing four-read budget. Failed batches store no proposals. | Deferred-promise route tests prove concurrent reads and two provider calls total for a two-read task, rather than three sequential calls. This is a round-count improvement, not a measured universal latency claim. |
| Exact secondary contact emails could miss their company | Literal exact address lookup across saved contacts returns actual company IDs and preserves ambiguous matches. SQL wildcard characters remain literal. | Secondary-email, ambiguity and wildcard tests. |
| Variant SKU requests could miss inactive parent products | Exact variant SKU/ID resolution returns its actual parent and matching saved variant. Bounded scans stop honestly beyond 5,000 products. | Inactive variant, parent-SKU casing and bounded-coverage tests. |
| No general personal-task creation or partial editing | Added own-task create/update, title, notes, priority, due time and status; preserved omitted fields; atomic timestamp checks reject concurrent changes. Creation uses the claimed action ID to prevent duplicates. | Real preparation/execution and task-service tests; teammate ownership, database errors, retry and race checks. AI shipping tasks cannot be bypassed by generic task edits. |
| No agent CSV export | Selected IDs, saved audiences, search or all-company export; authenticated owner-only download after completed approval; 30-minute expiry and changed-data checks. Specific IDs filter the database before loading company data. | Export selection, saved audience, unavailable records, stale/foreign/unapproved/expired download tests. Limit: 5,000 source companies and 4 MB CSV; no silent truncation. |
| CSV quoting did not prevent spreadsheet formulas | Shared CSV writer neutralizes leading formula characters, preserves Unicode, quotes and newlines. Both manual UI exports and agent downloads use it. | Formula, Unicode and escaping tests; oversized Unicode export refusal. |
| No direct agent PDF download | Added authenticated saved invoice/catalog download links and native download anchors. Document identity and snapshot are verified before approval. | Invoice/catalog path, stale invoice and arbitrary-URL rejection tests. |
| No conversation AI controls | Added accessible status reads, explicitly approved enable/pause and shipping approval using the existing authenticated email services. Mailbox, RFC headers and recipient come from saved emails. | Inbound-message guard, receiving-mailbox binding, manual review, preserved existing shipping review, paused background-revision handling and service-error tests. |
| Shipping approval could outlive the generic action function | Action execution receives the same 240-second budget as the existing email endpoint's deferred worker. Results say queued, not delivered. | Integer-cent totals, assignee/role checks and queued-result tests; no customer automation enabled for testing. |
| No reusable approved business knowledge action | Admin/operator can inspect, add or delete explicitly approved facts through existing knowledge services, always with manual review. | Role, stale fact, add/delete dispatch and approval tests. Retrieved emails/web pages cannot authorize workspace policy. |
| Partial product edits could overwrite unrelated metadata | Preserve custom descriptions and nonmanaged source tags, replacing only generated tier/variant metadata. Require an actual unchanged row to confirm the save. | Shared product-save tests cover preservation, missing rows, database failure and concurrent edits. |
| Provider failure after a successful lookup could be mislabeled as a CRM read failure | Separate model generation from the database-read error boundary. | Route test verifies the provider error remains an HTTP 502 response. |
| A live combined task/knowledge-preview request produced an invalid action response | Validate action protocol before storing proposals and allow one bounded re-plan with schema error codes/paths. Read and action repairs share the same single allowance. Persistent failures stop without proposals. | Reproduced on the published site; regression tests cover corrected compound actions, repeated invalid responses, Chat staying read-only and the shared repair budget. No executed action is retried. |

## Release validation

The isolated release directory is `.vercel/agent-productivity-release-20261029`, based on the prior audited live release. It excludes unrelated ongoing email/history/task-interface changes in the shared workspace. Its complete suite passed **724 tests**, ESLint, generated Next.js route types and TypeScript. The additional live-discovered protocol fix passed focused lint and TypeScript again; its regression tests are included in the full count. Production deployment and live action results are recorded below.

The shared workspace's broader suite was also run. It encountered failures in simultaneously changing task-interface tests and translation coverage; those unrelated edits were excluded from this release. This report does not describe that shared tree as fully passing.

## What “training” means here

The deployed agent receives improved capability instructions, concrete validated tools and regression tests. Explicitly approved business facts persist for future automatic email replies. This is application improvement and approved knowledge storage, not model fine-tuning or an unrestricted ability to teach itself new permissions.

## Remaining limits

- Credentials, login/OAuth, file selection/uploads and new ERP/provider connections still require their setup interfaces.
- Customer portal administration, dashboard layout and integration configuration have no dedicated agent operations.
- ERP stock uses configured warehouse aggregates; an absent ERP connection cannot produce verified inventory.
- Reads and exports are bounded. The agent cannot claim complete database analytics from a partial page.
- Dependent work requiring a newly created record's ID continues on a subsequent user turn. There is no autonomous post-approval continuation engine.
- Live conversation enablement, shipping-triggered invoice mail, global knowledge changes, real payment entries, permission changes and destructive actions were not performed merely to test them. Their service boundaries, roles, approvals, stale snapshots and failures are exercised with isolated fixtures. Prior authorized test emails were received and their PDF opened, as confirmed by the user.

## Live action verification

The first upgrade built successfully as `dpl_AK6LUibPZFkSnLArSvwYnDwouqG5` and was promoted to `https://crm.filazoosupply.com`. Both staged and published health checks returned HTTP 200 with the database connected. The initial error/fatal runtime-log scan returned no entries for this deployment in the inspected 15-minute window.

| Published-site check | Observed result |
| --- | --- |
| Create general task | Approved `AI AUDIT PHASE2 20261029`, ID `efcbe485-6df0-47f3-a6d9-4a8d26132546`, assigned to the signed-in user, no company, normal priority, no due date, synthetic notes. Independent Tasks page confirmed the saved record. |
| Partial task edit | Approved only high priority and 30 October 2099 09:00 Asia/Shanghai. A fresh Tasks page showed the correct date/time, title and unchanged notes. |
| One-company export | Approval showed count 1 and the synthetic customer's name. Actual browser download contained a 305-byte UTF-8 CSV: one header and one data row, no other customers. Saved evidence: `output/agent-upgrade-selected-company.csv`. |
| Saved draft PDF | Approved download of existing `INV-000037`, not issuance, editing or sending. Actual invoice-specific link downloaded 59,805 bytes, `%PDF-1.3` header and `%%EOF` terminator. Saved evidence: `output/agent-upgrade-INV-000037-DRAFT.pdf`. |
| Compound read-only lookup | Agent returned the correct saved company for an exact contact email, inactive parent `AI-AUDIT-20261029`, White variant `audit-white` / `AI-AUDIT-20261029-01` at $2.50, and the newly edited task's actual ID, high priority, open status and UTC due time corresponding to 09:00 Shanghai. No approval cards or writes. |
| Knowledge / conversation status | Live reads found no matching `AI AUDIT PHASE2 PREVIEW ONLY` fact and no accessible saved conversation AI setting for the authorized test address. Nothing was enabled or saved. |

The first four planning requests displayed 3.2–5.3 seconds in the UI; the three-resource read displayed 7.1 seconds. These observations are not a latency guarantee. Screenshot evidence of the independently verified task is `output/agent-upgrade-task-verified.jpg`.

The combined task-cancellation/knowledge-preview request revealed the protocol defect described above. The final recovery release, `dpl_8kNiyyPhckpkut47kY7gbpHNdRzM` (`filazoo-qh62ygkot-nex8gens-projects.vercel.app`), built successfully, passed its staged health check and was promoted to the same published CRM domain. The custom domain was then verified to resolve to that deployment. A final error/fatal runtime-log scan returned no entries in the inspected 15-minute window.

Repeating the exact combined request produced two correct approval cards in 9.2 seconds. The knowledge card was **declined** and reported nothing changed. The task update was **approved**, saved `cancelled`, cleared the due time and preserved title, notes and high priority. The independent Tasks page then showed no open tasks. A final read-only lookup independently confirmed the cancelled task, empty due time and zero matching synthetic knowledge facts. No customer automation was enabled, no new emails were sent and no synthetic policy was saved globally.

Final screenshot evidence: `output/agent-upgrade-actions-verified.jpg`. The deployed source hashes and exclusions are recorded in `.vercel/agent-productivity-release-manifest.json`. This is an isolated local-source deployment; unrelated working-tree changes were not committed or included.
