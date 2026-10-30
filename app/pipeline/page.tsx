import { redirect } from "next/navigation";
import { requireWorkspaceMember } from "@/lib/auth";

// Keep old bookmarks useful after retiring the sales-stage workspace.
export default async function RetiredSalesPage() {
  await requireWorkspaceMember();
  redirect("/companies");
}
