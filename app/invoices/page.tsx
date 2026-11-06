import { redirect } from "next/navigation";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ companyId?: string }> }) {
  await requireWorkspaceMember(["admin","operator","bd_manager","viewer"]);
  const { companyId } = await searchParams;
  redirect(companyId && z.uuid().safeParse(companyId).success ? `/companies/${companyId}?tab=purchase-orders` : "/purchase-orders");
}
