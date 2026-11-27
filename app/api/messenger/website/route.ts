import { invoiceAccess } from "@/lib/invoice-api";
import { getWebsiteInboxData } from "@/lib/data/messenger";
import { canCreateInvoices } from "@/lib/invoice-permissions";

export async function GET() {
  const access = await invoiceAccess();
  if (access.response) return access.response;
  try {
    const data = await getWebsiteInboxData();
    return Response.json({ ...data, canReply: canCreateInvoices(access.viewer.role) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Website messages could not be refreshed." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

