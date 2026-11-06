import { notFound } from "next/navigation";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { listCompanyOptions } from "@/lib/data/crm";
import { getPurchaseOrderProfile } from "@/app/purchase-order-actions";
import { PurchaseOrderComposer } from "@/components/purchase-order-composer";
import { getInvoiceDefaults } from "@/lib/data/invoice-defaults";
import { invoiceDocumentWithDefaults } from "@/lib/invoice-defaults";
import { orderBillingFromInvoice } from "@/lib/purchase-order-billing";

export const metadata = { title: "Create order" };

export default async function NewPurchaseOrderPage({ searchParams }: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const params = await searchParams;
  const companyId = typeof params.companyId === "string" ? params.companyId : "";
  if (companyId && !z.uuid().safeParse(companyId).success) notFound();
  const { companies } = await listCompanyOptions();
  if (companyId && !companies.some(company => company.id === companyId)) notFound();
  const [profile, settings] = await Promise.all([companyId ? getPurchaseOrderProfile(companyId) : Promise.resolve(null), getInvoiceDefaults()]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const billing = orderBillingFromInvoice(invoiceDocumentWithDefaults(today, { ...settings.seller, defaults: settings.defaults }));
  return <PurchaseOrderComposer companies={companies} initialCompanyId={companyId} initialProfile={profile} initialBilling={billing} today={today} />;
}
