import { processDueFlowRuns } from "@/lib/data/flow-runtime";
import { env } from "@/lib/env";
import { after } from "next/server";
import { forEachWorkspace } from "@/lib/data/workspace-runtime";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const task = new URL(request.url).searchParams.get("task");
  if (task === "health") return Response.json({ ok: true, liveSending: !env.dryRun, version: "flow-reliable-v4" }, { headers: { "Cache-Control": "no-store" } });
  if (task === "preflight") {
    const { checkWorkspaceFlowHealth } = await import("@/lib/data/flow-health");
    const workspaces = await forEachWorkspace(async workspaceId => ({ workspaceId, ...await checkWorkspaceFlowHealth() }));
    return Response.json({ ok: true, ready: workspaces.every(workspace => workspace.ready), workspaces }, { headers: { "Cache-Control": "no-store" } });
  }
  if (task && !["resume", "intake", "scheduled-email", "automatic-replies"].includes(task)) return Response.json({ ok: false, error: "Unknown workflow worker." }, { status: 400 });
  // pg_net shares its HTTP batch with mail sync and other scheduled work.
  // Acknowledge promptly, then drain saved work within the function lifetime.
  after(async () => {
    const deadline = Date.now() + 240_000;
    await forEachWorkspace(async (workspaceId, count) => {
    const phases = task === "scheduled-email" ? [
      { name: "scheduled-email", run: async () => {
        const [{ processScheduledEmails }, { deliverEmail }] = await Promise.all([import("@/lib/data/email-delivery"), import("@/lib/data/manual-email-send")]);
        return processScheduledEmails(deliverEmail, { deadline });
      } },
    ] : task === "automatic-replies" ? [
      { name: "automatic-replies", run: async () => {
        const { processEmailAutoReplies } = await import("@/lib/data/email-auto-reply-worker");
        return processEmailAutoReplies(undefined, { deadline });
      } },
    ] : [{ name: task === "resume" ? "workflows" : "receipts-and-enrollment", run: () => processDueFlowRuns(task === "resume" ? 10 : 0,
      { syncMailbox: true, budgetMs: Math.max(15_000, Math.floor((task === "resume" ? 180_000 : 60_000) / count)), actionDeadline: deadline, scanTriggers: task !== "resume" }) }];
    const results = await Promise.allSettled(phases.map(phase => phase.run()));
    results.forEach((result, index) => {
      if (result.status === "rejected") console.error("Workflow background phase failed; saved work remains recoverable.", { workspaceId, phase: phases[index].name, error: result.reason instanceof Error ? result.reason.message : "Unknown error" });
      else console.info("Workflow background phase completed.", { workspaceId, phase: phases[index].name, result: result.value });
    });
    }, { rotate: true, deadline });
  });
  return Response.json({ ok: true, queued: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
