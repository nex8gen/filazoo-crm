import { requireWorkspaceMember } from "@/lib/auth";
import { getWorkspaceSettings } from "@/lib/data/workspace-settings";
import { listFlows } from "@/lib/data/flows";
import { loadFlowFacts, validateFlowResources } from "@/lib/data/flow-runtime";
import { simulateFlow } from "@/lib/flow-engine";
import { flowInputSchema } from "@/lib/flows";

export async function POST(request: Request, context: RouteContext<"/api/flows/[id]/test">) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { contactId?: string; companyId?: string; conversationId?: string };
  const flow = (await listFlows(viewer.id)).find((item) => item.id === id);
  if (!flow) return Response.json({ ok: false, error: "Workflow not found." }, { status: 404 });
  try {
    const input = flowInputSchema.parse(flow);
    await validateFlowResources(viewer.id, input);
    const facts = await loadFlowFacts({ userId: viewer.id, contactId: body.contactId, companyId: body.companyId, messageKey: body.conversationId, conversationId: body.conversationId, savedSegmentId: typeof flow.triggerConfig.savedSegmentId === "string" ? flow.triggerConfig.savedSegmentId : undefined });
    const schedule = await getWorkspaceSettings();
    return Response.json({ mode: "simulation", facts, ...simulateFlow(input, facts, new Date(), { schedule }), warnings: ["Simulation only; no messages were sent or CRM actions executed."] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Workflow test failed." }, { status: 400 });
  }
}
