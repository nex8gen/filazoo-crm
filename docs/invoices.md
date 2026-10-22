# Invoice system

Open **Workspace → Invoices** (`/invoices`). Admins and operators create and manage billing; viewers can read and print. BD managers do not have billing access. Each invoice has an authenticated detail URL at `/invoices/<id>`.

Create a draft with seller and customer billing details, tax IDs, currency, dates, PO reference, line items, terms, and bank instructions. Save, review, and issue it. Issuing locks the document and does not send an email. Use **Print / Save PDF** to download a copy through the browser print dialog.

Record payments after money arrives. Partial payments reduce the balance; paid and overdue states are derived from the balance and due date. Payment methods describe external receipts; this feature does not charge cards or move money. Unpaid issued invoices can be voided. Only drafts can be deleted. Payment reversals, credit notes, recurring billing, and automated email delivery are not implemented.

## Amounts and rounding

USD, EUR, GBP, CNY, CAD, AUD, and HKD are supported. Money is stored in integer cents and quantities are whole units. Each item has a tax percentage (basis points internally). The invoice discount is allocated proportionally across items using cumulative integer allocation, then tax is rounded to the nearest cent per line. Shipping is untaxed. Supported limits: 100 items, 1,000,000 units per item, 1,000,000 currency units per unit price/discount/shipping/payment, and 1,000,000,000 currency units subtotal.

Customer and seller details are snapshots, so later changes elsewhere in the CRM cannot change issued documents. Numbering uses a database identity sequence (`INV-000001` format). Gaps from deleted drafts or rolled back inserts are expected. Dates use UTC calendar dates consistently on the server.

## Backend

- `GET /api/invoices?page=0&search=customer&status=draft`: 25 records per page, newest first. Status filters accept `draft`, `issued` (including paid/partial/overdue), or `void`. Dashboard balances explicitly cover the current page and group currencies separately.
- `POST /api/invoices`: validates a complete document and creates a draft; the server calculates its total.
- `GET /api/invoices/<uuid>`: document and payment history.
- `PATCH /api/invoices/<uuid>`: `save`, `issue`, `void`, `delete`, or `payment`. Draft changes and transitions require the current `revision`. Payments require a UUID idempotency key.

Tables: `invoices`, `invoice_payments`, `invoice_events`. All use RLS with no browser grants, matching the existing server-only CRM architecture. API routes validate active membership and billing roles. `mutate_invoice` is executable only by `service_role`, runs as invoker, and checks the actor's current membership. It locks the invoice row before changing state or balances, rejects stale edits, duplicate-key conflicts, future payment dates, and overpayments. Status changes, edits, and payments write audit events in the same transaction.

Apply `supabase/migrations/20261022093507_invoice_system.sql` to an existing database. This migration is already applied to the linked project; its filename matches the remote migration history. Fresh installations can use `supabase/schema.sql`, which includes the invoice schema. No additional environment variables are needed beyond the existing Supabase configuration.

## Verification

Run `node --experimental-strip-types --test tests/invoices.test.ts` for financial calculations and validation. Run `tests/invoices-database.sql` in a migrated database with an active admin/operator to check transitions, revision conflicts, payment idempotency, balance enforcement, and direct Data API permissions. The database suite rolls back its fixtures and uses explicit negative test numbers to avoid consuming invoice numbers.
