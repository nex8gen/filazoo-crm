import { requireWorkspaceMember } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { readEmailCustomerContext } from "@/lib/data/email-customer-context";

export const maxDuration = 30;
export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = new URL(request.url).searchParams;
  const email = (params.get("email") || "").trim().toLowerCase(), mailboxId = params.get("mailboxId") || "";
  if (!mailboxId || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Invalid customer email." }, { status: 400 });
  return withWorkspaceViewer(viewer, async () => {
    try {
      const context = await readEmailCustomerContext(viewer, mailboxId, email, request.signal);
      return context ? Response.json({ email, context }, { headers: { "Cache-Control": "private, no-store" } }) : Response.json({ error: "Customer unavailable." }, { status: 404 });
    } catch { return Response.json({ error: "Unable to load customer details." }, { status: 503 }); }
  });
}
