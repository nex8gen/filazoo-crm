import type { WorkspaceViewer } from "@/lib/auth";
import { getInvoiceDefaults } from "@/lib/data/invoice-defaults";
import { canManageBilling } from "@/lib/invoice-permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaymentsSection } from "./payments";
import { InvoiceDefaultsForm } from "../invoice-defaults-form";

export async function InvoicesSection({ viewer }: { viewer: WorkspaceViewer }) {
  const defaults = await getInvoiceDefaults();
  return <div className="settings-content settings-section-enter space-y-6"><nav aria-label="Billing sections" className="settings-section-links"><a href="#invoice-defaults">Invoice defaults</a><a href="#payment-methods">Payment methods</a></nav><Card id="invoice-defaults" className="shadow-none"><CardHeader><CardTitle>Seller and invoice defaults</CardTitle><CardDescription>Applies to new invoices. Customer billing profiles can override currency and due dates.</CardDescription></CardHeader><CardContent><InvoiceDefaultsForm initial={defaults} canManage={canManageBilling(viewer.role)} /></CardContent></Card><section id="payment-methods" aria-label="Payment methods"><PaymentsSection viewer={viewer} /></section></div>;
}
