import { getWorkspaceViewer } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { readAiBudget } from "@/lib/ai/budget-server";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  let viewer;
  try { viewer = await getWorkspaceViewer(); }
  catch { return Response.json({ error: "Unable to verify your workspace session. Please retry." }, { status: 503, headers }); }
  if (!viewer) return Response.json({ error: "Sign in to view AI usage." }, { status: 401, headers });
  try {
    return await withWorkspaceViewer(viewer, async () => {
      const limits = await readAiBudget(viewer.id);
      if (!limits.credits) throw new Error("Credits unavailable");
      const { includedMicros, topupMicros, usedMicros, remainingMicros, resetsAt, percent } = limits.credits;
      // Keep internal spending policies and provider request details off the wire.
      return Response.json({ credits: { includedMicros, topupMicros, usedMicros, remainingMicros, resetsAt, percent }, enabled: limits.enabled !== false }, { headers });
    });
  } catch {
    return Response.json({ error: "Unable to load AI usage. Please try again." }, { status: 503, headers });
  }
}
