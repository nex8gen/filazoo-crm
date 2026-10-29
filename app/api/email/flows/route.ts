import { requireWorkspaceMember } from "@/lib/auth";
import { resolveEmailFlowScope } from "@/lib/data/email-flows";
import { listEmailFlows } from "@/lib/data/flows";

export async function GET(request: Request) {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  try {
    const scope = await resolveEmailFlowScope(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json({ ok: true, flows: await listEmailFlows(scope) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unable to load email flows." }, { status: 400 });
  }
}
