import { requireWorkspaceMember } from "@/lib/auth";
import { listFlows } from "@/lib/data/flows";
import { loadFlowFacts } from "@/lib/data/flow-runtime";
import { simulateFlow } from "@/lib/flow-engine";

export async function POST(request: Request, context: RouteContext<"/api/flows/[id]/test">) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { contactId?: string; companyId?: string; conversationId?: string };
  const flow = (await listFlows(viewer.id)).find((item) => item.id === id);
  if (!flow) return Response.json({ ok: false, error: "Flow not found." }, { status: 404 });
  const facts = await loadFlowFacts({ userId: viewer.id, contactId: body.contactId, companyId: body.companyId, messageKey: body.conversationId }).catch(() => ({ customerReplied: false, openedEmail: false, clickedLink: false, category: null, segment: null, country: null, companyStatus: null, pipelineStage: null, fitScore: null }));
  const simulation = simulateFlow({ name: flow.name, triggerType: flow.triggerType, triggerConfig: flow.triggerConfig, status: flow.status, steps: flow.steps.map((step) => ({ id: step.id, type: step.type, config: step.config })) }, facts);
  return Response.json({ mode: "dry-run", facts, ...simulation }, { headers: { "Cache-Control": "no-store" } });
}
