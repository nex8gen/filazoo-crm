import type { WorkspaceViewer } from "@/lib/auth";
import { invoicePaymentMethods } from "@/lib/data/invoice-payment-methods";
import { canManageBilling } from "@/lib/invoice-permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaymentMethodsForm } from "../payment-methods-form";

export async function PaymentsSection({ viewer }: { viewer: WorkspaceViewer }) {
  const methods = await invoicePaymentMethods();
  return <div className="settings-content settings-section-enter space-y-4"><Card className="shadow-none"><CardHeader><CardTitle>Customer payment methods</CardTitle><CardDescription>Payment options you can add to customer invoices.</CardDescription></CardHeader><CardContent><PaymentMethodsForm initial={methods} canManage={canManageBilling(viewer.role)} /></CardContent></Card></div>;
}
