import { getCompanyPortal } from "@/lib/data/company-portal";
import { CompanyPortalWorkspace } from "@/components/company-portal-workspace";
import { z } from "zod";

export async function CompanyCustomerPortal({ companyId, companyName, invoiceId, canWrite }: { companyId: string; companyName: string; invoiceId?: string; canWrite: boolean }) {
  const selectedId = z.uuid().safeParse(invoiceId).success ? invoiceId : undefined;
  const data = await getCompanyPortal(companyId, 0, selectedId);
  if (!data) return null;
  return <CompanyPortalWorkspace companyId={companyId} companyName={companyName} initial={data} invoiceId={invoiceId} canWrite={canWrite} />;
}
