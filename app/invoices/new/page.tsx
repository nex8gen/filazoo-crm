import { redirect } from "next/navigation";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ companyId?: string }> }) {
  await requireWorkspaceMember(["admin","operator","bd_manager"]);
  const { companyId } = await searchParams;
  redirect(companyId && z.uuid().safeParse(companyId).success ? `/purchase-orders/new?companyId=${companyId}` : "/purchase-orders/new");
}
