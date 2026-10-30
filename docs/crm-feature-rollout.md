# CRM feature rollout

Build and verify one feature before starting the next. Preserve existing work in
this checkout. The existing Catalog is the quotation feature; extend it rather
than creating a competing module. Calendar and meeting integrations are excluded
at the user's request. Shipping and tracking must come from the ERP, not a new
carrier integration.

1. My Day: completed a personal work queue using existing tasks,
   company follow-ups, reply reviews and issued unpaid invoices.
2. Search across CRM records: implemented in the workspace search dialog.
3. Catalog/quotation lifecycle: completed in the existing Catalog workspace.
4. Sample requests, dispatch, feedback and conversion tracking.
5. Unanswered-message ownership and response deadlines.
6. Team reorder watchlist using the existing purchase analysis.
7. ERP shipping/tracking connection; inspect supported ERP data first.
8. Profit and discount controls, based on reliable product costs.
9. After-sales cases linked to customer, order and product.

## My Day

Route: `/my-day`. Refresh: authenticated `GET /api/my-day`. Uses current workspace
membership; tasks and replies are personal, follow-ups are account-owned, and
invoices are either created by the teammate or linked to their assigned accounts.
No shared user cache, new tables, email sends or payment mutations. Source failures
remain visible instead of silently claiming the queue is complete. Review links
open existing task, customer and invoice workflows.

Validation: `tests/my-day*.test.ts`; read-only real database check:

```powershell
node --env-file=.env.local scripts/run-task-verification.cjs scripts/verify-my-day.ts
```

Browser checks cover navigation, filtering, search, refresh, task review and mobile.

Verified on 2026-10-30: 995 automated tests passed, ESLint passed, TypeScript
passed, and an isolated production build passed. The shared build directory was
in use by another build, so production compilation used an ignored copy under
`tmp/` with the same source and dependencies. Real read-only database checks passed
for all five active members. Browser checks passed for English, Simplified
Chinese, a 390 px mobile width, filtering, search, refresh, and the existing task
review link. Existing invoice task preparation may still require resolving its
AI Gateway billing error; My Day does not change that provider configuration.

## Workspace record search

Open **Search workspace** or press **Ctrl+K**. The existing page shortcuts remain
available. Searches also return company names/domains, contact names/emails,
formatted invoice numbers and references, customer PO references, product names
and SKUs, personal task titles, and saved shipment tracking numbers. Results are
limited to the top six per type; this is a quick lookup rather than an export.
Mailbox message bodies are still searched in the existing email workspace.

API: authenticated `GET /api/workspace/search?q=...`, private/no-store. BD customer
queries enforce current account ownership, with an additional source for invoices
they created. Tasks stay assigned-to-me. Product names and active flags apply only
the current teammate's private overrides. No mailbox credentials, message bodies,
banking details or other teammates' private product edits enter results. Input is
bounded, LIKE wildcards are escaped, and filter operands are quoted. A failed type
is identified explicitly while other sources remain available. Debounced requests
are cancelled when the query changes; stale responses cannot replace new results.

PO results carry a company-scoped `orderId` into the existing purchase-order view.
Filtering happens before pagination, so an older matching order is visible. The
view-all link restores ordinary browsing. It does not change order data.

Verification on 2026-10-30: 1,015 automated tests passed; ESLint and TypeScript
passed; production compilation passed in an isolated source copy. Read-only live
checks passed all seven sources for all five active members, invoice lookup, PO
lookup and punctuation/escaped-wildcard queries. Browser checks include search,
keyboard invoice selection, exact order selection, return to the full order list,
retry after a timeout and rapid query changes. Simplified Chinese headings, task
status metadata, Chinese-text queries and the 390 px mobile layout were verified.
Ctrl+K opens the dialog, and the original language/viewport were restored after
testing. Final localization adjustments passed 19 focused checks and the full
suite. All 12 production shell bundle checks passed.

Read-only integration check:

```powershell
node --env-file=.env.local scripts/run-task-verification.cjs scripts/verify-workspace-search.ts
```

## Company quotations

Open **Products → Company Quotations → Open quotation**. The original Catalog
records and URLs remain in use. Prepare quantities and variants from the saved
product snapshot, choose saved quantity pricing or an explicit agreed price, and
enter validity, shipping, billing and payment terms. The list supports quotation
reference lookup and shows the current status. Prepared quotations have their own
private PDF; the original product selection PDF remains available in the detail.

Record sharing after staff share the document outside the CRM. Record acceptance
with a note describing the customer's confirmation. Neither action sends a
message or provides an electronic signature. Shared and accepted commercial
details require a new version to change. Expiry follows China business dates;
expired shared offers cannot be accepted. A previous accepted version retains its
order and history when a new draft is created.

An accepted quotation creates one **draft** purchase order with the accepted
SKU, quantities, prices, customer details and terms. Shipping is a separate order
line, which participates in the existing invoice quantity reservations. The order
must be reviewed and confirmed before the existing invoice workflow is available.
Repeated conversion requests return the existing order. Unavailable product links
require an explicit choice to preserve those lines as custom items.

Older Catalogs without frozen product snapshots require **Create current
version**. This freezes today's private product data in a separate version and
leaves the older record unchanged. Drafts can be cancelled before commercial
details are saved. Commercial edits never change the product catalog's prices.

Quotation reads and PDF downloads remain private to the Catalog owner. Writes
require an active admin/operator/BD account; BD writes also require current
customer ownership. The server validates inputs and resolves prices. The database
function checks ownership, uses row locks and revision checks, and records the
mutation and audit event in one transaction. The RPC is unavailable to anonymous
and browser-authenticated database roles. Private quotation events are filtered
from other teammates' customer activity views.

Verified on 2026-10-30: all 1,050 automated tests, ESLint, production compilation
and all 12 client shell bundle budgets passed. The production build ran in an
isolated ignored source copy to preserve the shared development server. Database
integration assertions passed inside a rolled-back transaction, including stale
edits, missing acceptance notes, unconfirmed freight, expired offers, immutable
shared prices, historical versions, unsaved cancellation and repeat conversion.
Read-only server checks rejected the other four active members' access and viewer
writes. The applied migrations and local migration filenames are synchronized.

Browser verification used the existing **AI AUDIT 20261029 DO NOT CONTACT**
record: created a current version, saved/reloaded a $512.34 quotation, recorded
synthetic sharing/acceptance, downloaded its PDF and opened its draft order. The
order retained 100 × $5.00 product units, $12.34 freight and a 30% pre-shipment
payment requirement. No invoice was issued or customer message sent. English,
Simplified Chinese, exact reference lookup and 390 px mobile width were checked;
language and viewport were restored. PDF visual checks covered the saved offer
and a 99-line Chinese document. A header overlap found during QA was corrected.
The existing browser extension adds Grammarly body attributes, producing a dev
hydration notice; the quotation workflow checks completed successfully.

Verification sources: `tests/quotations.test.ts`, `tests/quotation-route.test.ts`,
`tests/quotations-database.sql`, `scripts/verify-quotations.ts`. The database test
rolls back all its fixtures; the browser's clearly labelled internal QA quotation
and draft order remain available for review.

```powershell
node --env-file=.env.local scripts/run-task-verification.cjs scripts/verify-quotations.ts
```

Next feature: sample requests, dispatch, feedback and conversion tracking. Other
features remain queued in the order above. Calendar integrations remain excluded;
shipping and tracking integration will use the ERP.
