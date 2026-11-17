import { blankInvoiceDocument } from "./invoices.ts";
import { projectPortalData, type PortalDesign } from "./portal-design.ts";

/** Synthetic data only: the builder never reads a real customer's invoice. */
export function portalPreviewData(design: PortalDesign) {
  return projectPortalData({
    invoice: { id: "preview", number: 1082, status: "issued", paid_minor: 120000, total_minor: 240000, revision: 1,
      created_at: "2026-11-01T08:00:00Z", updated_at: "2026-11-01T08:00:00Z",
      document: { ...blankInvoiceDocument("2026-11-01"), sellerName: design.brandName, customerName: "Alex Morgan", customerEmail: "alex@example.com", reference: "PO-2048", dueDate: "2026-11-30", currency: "USD", items: [{ description: "Custom product collection", quantity: 120, unitPriceMinor: 2000, taxBps: 0 }] } },
    email: "alex@example.com", needsPassword: false,
    messages: [{ id: "welcome", sender: "staff", body: "Hi Alex! Your order is on its way. Let us know if you need anything.", created_at: "2026-11-01T08:00:00Z" }],
    shipment: { status: "in_transit", carrier: "DHL Express", location: "Distribution center", tracking_number: "DEMO-2048", tracking_url: "", expected_delivery: "2026-11-20" },
    order: { reference: "PO-2048", status: "shipped", deliveryDate: "2026-11-20" },
  }, design);
}
