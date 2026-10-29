# Purchase order product connections — 2026-10-29

The company Purchase orders tab records customer POs received by Filazoo. Catalog links are saved as product SKU and variant identifiers alongside an immutable commercial snapshot once invoices reserve quantities.

## Issues repaired

| Issue | Result |
| --- | --- |
| Custom order lines could not be linked to Products. | Connect an existing line to a product and variant while keeping its quantity and agreed price. |
| Linked products could only be removed by deleting the line. | Change the selected product or convert it to a custom item. The final line can also be cleared. |
| Product images and quantity breaks were hidden. | Catalog choices show variant images, MOQ, stock labels, and tier prices; saved lines show their product image. |
| Catalog repricing left stale descriptions and images, which then failed save validation. | Explicit refresh reloads current product data and updates the complete snapshot. A separate action retains the agreed price. |
| An empty catalog gave no useful explanation when order and product currencies differed. | Display available currencies and counts and explain how to select a matching order currency. No currency conversion is implied. |
| A late product lookup could leave quantity pricing without usable catalog data. | Store loaded products in React state, disable catalog quantity editing until the product is available, and provide explicit refresh/manual/custom recovery actions. |
| Invoice creation could use the saved PO while unsaved edits were visible. | Disable invoice creation while the editor has unsaved changes. |
| Fully reserved orders still offered another invoice. | Disable invoice creation when drafts and issued invoices reserve every remaining quantity. |
| Returning from a new invoice reused stale order state. | Key the workspace to the server snapshot so invoice reservations, locks, and payment summaries refresh after revalidation. Prevent opening old rows during a list refresh. |
| Database writes could accept nonexistent product links, inconsistent totals, or changed invoice product metadata. | Add restricted, security-invoker triggers for product availability/currency, SKU consistency, MOQ, integer line amounts, totals, and invoice product snapshot identity. Preserve unchanged historical lines. |
| Shipment eligibility showed zero-value invoices as paid although the database rejects that under prepayment terms. | Align the displayed eligibility with the database's positive-invoice-total requirement. |

## Verification

- Final repository checks passed: ESLint, 757 tests, the Next.js production build, and client bundle budgets. Concurrent AI assistant changes briefly interrupted a build; the final build passed without modifying those files as part of this PO work.
- Applied `purchase_order_product_connections` to the configured Supabase project.
- Passed rollback-only SQL suites: `purchase-orders-database.sql`, `order-invoice-connections-database.sql`, and `purchase-order-products-database.sql`.
- Browser verification with an isolated company: connected a custom line at quantity 100 and agreed price USD 4.50; refreshed catalog pricing to USD 5.00; increased quantity to 500 and verified USD 4.79 pricing and USD 2,395.00 total; saved and reopened the PO; confirmed image and product/variant identifiers persisted.
- Created a draft invoice from the PO and verified its product image, SKU, quantity, agreed price, and order reference in both the database and invoice page. Reduced its reservation to 100 units, then created a second draft for only the remaining 400 units. Returning to the PO showed both drafts, locked product fields, and disabled further allocation.
- All temporary company, PO, draft invoice, and activity records were removed after verification. No invoice was issued or emailed.
- Added regression coverage for full-snapshot refresh, manual price preservation, custom conversion, readable historical snapshots, and remaining invoice allocations. Added Simplified Chinese screen text.

## Using the feature

Open a company → Purchase orders → Add purchase order. Enter the customer's PO number, choose a currency matching Products, and add a product/variant from the catalog. Use Connect to product for an existing custom line. Save the PO as Confirmed before creating its invoice. Draft invoices reserve quantities; edit a linked draft for a partial invoice, then invoice the remaining quantity from the PO. Products are locked while non-void linked invoices exist.

The database migration is applied. Frontend and server-action changes are in this checkout and require the normal application deployment for production use.
