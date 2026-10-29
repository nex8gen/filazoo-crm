import { requireWorkspaceMember } from "@/lib/auth";
import { listFlowCustomers } from "@/lib/data/flow-customers";
import { flowCustomerQuerySchema } from "@/lib/flow-customers";

export async function GET(request: Request) {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = new URL(request.url).searchParams;
  const parsed = flowCustomerQuerySchema.safeParse({
    kind: params.get("kind") ?? undefined,
    query: params.get("query") ?? undefined,
    companyId: params.get("companyId") ?? undefined,
    ids: params.has("ids") ? params.get("ids")!.split(",") : undefined,
    offset: params.get("offset") ?? undefined,
  });
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.issues[0]?.message || "Invalid customer search." }, { status: 400 });
  try {
    return Response.json({ ok: true, ...await listFlowCustomers(parsed.data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unable to load customers." }, { status: 500 });
  }
}
