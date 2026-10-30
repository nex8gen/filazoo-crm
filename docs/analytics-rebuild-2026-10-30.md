# Analytics rebuild — 30 October 2026

> Historical rebuild report. The sales-stage sections described below were subsequently removed at the user's request. See [the retirement record](sales-feature-retirement-2026-10-30.md) for the current behavior.

## CRM review and reporting coverage

The analytics entry point is `/`. Its page now reports across the existing CRM instead of treating every feature as a sales lead. `lib/data/analytics.ts` authorizes an active workspace member before querying. `lib/analytics-dashboard.ts` defines the reporting contract and calculations. No schema migration or fabricated history was required.

| CRM capability | Analytics section | Backend and scope |
| --- | --- | --- |
| Companies, acquisition, segments, assignment, pipeline | New companies, acquisition sources, current pipeline, overdue follow-ups | `companies`, `pipeline`, `workspace_members`; workspace records excluding `sample_seed` |
| Purchase orders | Confirmed order count and value | `purchase_orders`; order date, company scope, document currency, excludes draft/cancelled |
| Invoices, customer billing and portal balances | Issued invoice value, outstanding and overdue balances, invoice drilldowns | `invoices`; issue date for activity, current issued unpaid balances for receivables |
| Payment tracking | Cash collected and collections chart | `invoice_payments`; payment date, invoice currency; excludes void/draft invoices |
| Email outreach and replies | CRM outreach sent, replies, failed records | `emails` linked through `contacts`; sent/received event time; excludes private provider inbox content |
| Facebook and Instagram messaging | Received, sent and failed messages | `meta_messages`; workspace date scope; company source, owner and currency do not apply |
| Personal tasks and follow-ups | Open/overdue tasks, completed-in-period count, direct task links | `crm_tasks.assigned_to = viewer.id`; current open status, actual completion dates |
| Company catalogs and private product selections | Catalogs created and top selected SKUs | `catalogs.user_id = viewer.id`; uses the catalog's own currency; SKU counts once per catalog |
| Product catalog and ERP integration | Active products, stock records, unavailable stock, synchronization status | `products`; existing `getInventoryState()` honors the configured ERP account/warehouse scope |
| Workspace automation | Live flows, active runs, completed/failed runs | `flows`, `flow_runs`; excludes company/email-specific flows to match the workspace automation list |
| Personal AI assistant usage | Calls, tokens, failures and estimated USD cost | `ai_usage_events.user_id = viewer.id` |
| Notifications and customer portal | Existing navigation/notification controls retained | No portal visits or notification engagement events are invented |

Raw Meta/Shopify lead submissions are not added to company counts: that would double-count submissions already converted into companies. Combined source strings are reported as multiple sources; manual/historical email records are not mislabeled as Shopify.

## Metric and implementation corrections

- Pipeline estimates exclude won and lost companies. Missing estimates remain distinguishable from a genuine zero.
- Company headcounts are independent of the selected currency. Monetary reports never mix or convert currencies.
- Payments of older invoices are included by their payment date. Outstanding balances remain current regardless of the activity period.
- Draft and void invoices do not contribute to billed amounts or receivables. Invoices due today are not overdue.
- Stage distribution describes current stages. A newly created company's current won status is not presented as a historical win event or a reconstructed conversion funnel.
- Comparison windows use equal calendar periods, handle leap days, and show no prior activity instead of an invented 100% increase from zero.
- Reporting dates consistently use Asia/Shanghai. Each chart has at most 90 intervals while retaining all totals.
- Database readers paginate with exact counts, unique ordering, and actual returned page lengths. Tests cover 5,105 rows under a smaller API page cap.
- Sources fail independently. Dependent reports and CSV fields show unavailable instead of plausible zero values.
- Client payloads contain reporting fields, not message bodies, mailbox credentials, invoice documents, or automation execution context.
- CSV export includes the filters and snapshot timestamp, preserves numeric units, escapes quotes, and neutralizes formula-like strings.
- The issued-invoice drilldown now initializes both the server query and the invoice workspace status control from `?status=issued`.
- Charts load dynamically and maintain an explicit height during responsive resizing. English and Chinese UI copy is covered by the application's localization system.

## Live verification evidence

The authenticated browser loaded all 14 reporting sources. Independent SQL checks matched the initial 1–30 October USD report:

| Check | Result |
| --- | --- |
| New companies | 217 |
| Issued invoice value | 1,068,936 minor units = USD 10,689.36 |
| Recorded payment value | 1,068,936 minor units = USD 10,689.36 |
| Outstanding issued balance | USD 0.00 |
| Companies without pipeline estimates | 217; the UI displays “No estimates yet” |
| Source breakdown | Meta 73; Shopify 83; direct/email 55; multiple sources 6 |
| Invoice drilldown | `?status=issued` shows the two issued/paid invoices and selects issued status |
| CSV download | Downloaded and read back; filters and totals match the page |
| Mobile layout | 390 × 844 viewport; no horizontal overflow |
| Health endpoint | HTTP 200, database connected |
| Unauthenticated analytics request | HTTP 307 to `/login?next=%2F` |

Screenshots are in `docs/audit-evidence/analytics-mobile-20261030.png` and `analytics-desktop-20261030.png`.

## Remaining operational conditions

Successful reporting does not prove external delivery or enable unconfigured integrations. The live snapshot has historical failed automation runs, with logs citing address verification, mailbox daily limits, interrupted execution, and a product-variant selection guard. These records are displayed, not retried or relabeled as successful. ERP inventory is not configured in this snapshot, and all 217 pipeline estimates are missing. The health endpoint reports dry-run mode. No real customer email, payment, invoice mutation, or external ERP synchronization was triggered for this analytics verification.

## Reproducible checks

Run `npm.cmd run verify` for ESLint, the complete automated suite, production build/TypeScript validation, and bundle budgets. Analytics-specific tests are `tests/analytics-dashboard.test.ts`, `tests/analytics-data.test.ts`, and `tests/invoice-report-links.test.ts`. Browser tests additionally covered live source/owner/period/comparison filters, chart switching, refresh, CSV download, drilldowns, and desktop/mobile layout.

Final verification completed successfully: ESLint, all 908 automated tests, production compilation, TypeScript, prerendering, and every configured bundle budget passed. The browser reported no errors after the final refresh. A later refresh correctly reflected a newly added 218th company while retaining the independently verified invoice and payment totals; the table above records the initial snapshot rather than a frozen expected live count.
