import { requireWorkspaceMember } from "@/lib/auth";
import { getEmailInboxBackendData } from "@/lib/email-inbox";

export async function GET() {
  await requireWorkspaceMember(["admin", "operator", "viewer"]);
  const data = await getEmailInboxBackendData();

  return Response.json(data, {
    headers: { "Cache-Control": "no-store" },
    status: 200,
  });
}
