import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { saveEmailAutomationSettings } from "@/lib/data/email-state";
import { getEmailInboxBackendData } from "@/lib/email-inbox";
import { listFlows, updateFlow } from "@/lib/data/flows";

const stepSchema = z.object({
  id: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(160),
  delay: z.string().trim().min(1).max(100),
  action: z.string().trim().min(1).max(500),
  enabled: z.boolean(),
});
const automationSchema = z.object({
  enabled: z.boolean(),
  steps: z.array(stepSchema).min(1).max(20),
});

export async function GET() {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const data = await getEmailInboxBackendData();
  return Response.json({ ok: true, flow: data.automation, mode: data.mode, updatedAt: new Date().toISOString() }, {
    headers: { "Cache-Control": "no-store" },
    status: 200,
  });
}

export async function POST(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const parsed = automationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid automation settings." }, { status: 400 });
  }
  try {
    const flow = await saveEmailAutomationSettings(viewer.id, parsed.data.enabled, parsed.data.steps);
    try {
      const followUp = (await listFlows(viewer.id)).find((item) => item.name === "3-step follow-up");
      if (followUp) await updateFlow(viewer.id, followUp.id, {
        name: followUp.name,
        triggerType: followUp.triggerType,
        triggerConfig: followUp.triggerConfig,
        status: parsed.data.enabled ? "live" : "paused",
        steps: followUp.steps.map((step) => ({ id: step.id, type: step.type, config: step.config })),
      });
    } catch (syncError) {
      console.warn("Legacy automation saved, but the flow status could not be synchronized:", syncError);
    }
    return Response.json({ ok: true, flow, updatedAt: new Date().toISOString() }, {
      headers: { "Cache-Control": "no-store" },
      status: 200,
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unable to save the automation workflow." }, { status: 500 });
  }
}
