import { requireWorkspaceMember } from "@/lib/auth";
import { getEmailInboxBackendData } from "@/lib/email-inbox";

export async function GET(request: Request) {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const history = new URL(request.url).searchParams.get("scope") === "history";
  const data = await getEmailInboxBackendData({ history });

  return Response.json(data, {
    headers: { "Cache-Control": "no-store" },
    status: 200,
  });
}
