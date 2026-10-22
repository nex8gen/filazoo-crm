import { requireWorkspaceMember } from "@/lib/auth";
import { listFlows } from "@/lib/data/flows";
import { loadFlowFacts, validateFlowResources } from "@/lib/data/flow-runtime";
import { simulateFlow } from "@/lib/flow-engine";
import { flowInputSchema } from "@/lib/flows";

export async function POST(request: Request, context: RouteContext<"/api/flows/[id]/test">) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { contactId?: string; companyId?: string; conversationId?: string };
  const flow = (await listFlows(viewer.id)).find((item) => item.id === id);
  if (!flow) return Response.json({ ok: false, error: "Flow not found." }, { status: 404 });
  try {
    const input = flowInputSchema.parse(flow);
    await validateFlowResources(viewer.id, input);
    const facts = await loadFlowFacts({ userId: viewer.id, contactId: body.contactId, companyId: body.companyId, messageKey: body.conversationId, conversationId: body.conversationId });
    return Response.json({ mode: "simulation", facts, ...simulateFlow(input, facts), warnings: ["Simulation only; no messages were sent or CRM actions executed."] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Flow test failed." }, { status: 400 });
  }
}
