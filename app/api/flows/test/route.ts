import { requireWorkspaceMember } from "@/lib/auth";
import { loadFlowFacts, validateFlowResources } from "@/lib/data/flow-runtime";
import { flowInputSchema } from "@/lib/flows";
import { simulateFlow, matchesProfileFilters } from "@/lib/flow-engine";
import { z } from "zod";

const testInput = z.object({ flow: flowInputSchema, contactId: z.uuid().optional(), companyId: z.uuid().optional(), conversationId: z.string().max(512).optional() });

export async function POST(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const parsed = testInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.issues[0]?.message || "Invalid flow settings." }, { status: 400 });
  try {
    const { flow, contactId, companyId, conversationId } = parsed.data;
    await validateFlowResources(viewer.id, flow);
    const facts = await loadFlowFacts({ userId: viewer.id, contactId, companyId, messageKey: conversationId, conversationId, savedSegmentId: typeof flow.triggerConfig.savedSegmentId === "string" ? flow.triggerConfig.savedSegmentId : undefined });
    const warnings = ["This is a simulation; it does not send email or execute CRM actions."];
    if (!contactId && !companyId) warnings.push("No sample contact selected; engagement and company facts are empty.");
    return Response.json({ ...simulateFlow(flow, facts), facts, mode: "simulation", profileMatches: matchesProfileFilters(flow.triggerConfig, facts), warnings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Flow test failed." }, { status: 400 });
  }
}
