import type { WorkspaceViewer } from "@/lib/auth";
import { getInvoiceDefaults } from "@/lib/data/invoice-defaults";
import { canManageBilling } from "@/lib/invoice-permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaymentsSection } from "./payments";
import { InvoiceDefaultsForm } from "../invoice-defaults-form";

export async function InvoicesSection({ viewer }: { viewer: WorkspaceViewer }) {
  const defaults = await getInvoiceDefaults();
  return <div className="settings-content settings-section-enter space-y-6"><nav aria-label="Billing sections" className="flex flex-wrap gap-4 text-sm"><a className="text-primary underline underline-offset-4" href="#invoice-defaults">Invoice defaults</a><a className="text-primary underline underline-offset-4" href="#payment-methods">Payment methods</a></nav><Card id="invoice-defaults" className="max-w-2xl shadow-none"><CardHeader><CardTitle>Seller and invoice defaults</CardTitle><CardDescription>Shared workspace defaults for new invoices. Customer billing profiles can override currency and due dates. Existing invoices keep their saved details.</CardDescription></CardHeader><CardContent><InvoiceDefaultsForm initial={defaults} canManage={canManageBilling(viewer.role)} /></CardContent></Card><section id="payment-methods" aria-label="Payment methods"><PaymentsSection viewer={viewer} /></section></div>;
}
