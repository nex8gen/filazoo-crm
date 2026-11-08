import { processDueFlowRuns } from "@/lib/data/flow-runtime";
import { env } from "@/lib/env";
import { after } from "next/server";
import { forEachWorkspace } from "@/lib/data/workspace-runtime";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const task = new URL(request.url).searchParams.get("task");
  if (task === "health") return Response.json({ ok: true, liveSending: !env.dryRun, version: "flow-background-v3" }, { headers: { "Cache-Control": "no-store" } });
  // pg_net shares its HTTP batch with mail sync and other scheduled work.
  // Acknowledge promptly, then drain saved work within the function lifetime.
  after(async () => {
    const deadline = Date.now() + 240_000;
    await forEachWorkspace(async (_workspaceId, count) => {
    const phases = [
      { name: "workflows", run: () => processDueFlowRuns(50, { syncMailbox: task !== "resume", budgetMs: Math.max(5_000, Math.floor(180_000 / count)), actionDeadline: deadline }) },
      { name: "scheduled-email", run: async () => {
        const [{ processScheduledEmails }, { deliverEmail }] = await Promise.all([import("@/lib/data/email-delivery"), import("@/lib/data/manual-email-send")]);
        return processScheduledEmails(deliverEmail, { deadline });
      } },
      { name: "automatic-replies", run: async () => {
        const { processEmailAutoReplies } = await import("@/lib/data/email-auto-reply-worker");
        return processEmailAutoReplies(undefined, { deadline });
      } },
      { name: "conversation-tags", run: async () => {
        const { processAutomaticConversationTags } = await import("@/lib/data/conversation-tagging");
        return processAutomaticConversationTags({ maxConversations: 3 });
      } },
    ];
    const results = await Promise.allSettled(phases.map(phase => phase.run()));
    results.forEach((result, index) => {
      if (result.status === "rejected") console.error("Workflow background phase failed; saved work remains recoverable.", { phase: phases[index].name, error: result.reason instanceof Error ? result.reason.message : "Unknown error" });
      else console.info("Workflow background phase completed.", { phase: phases[index].name, result: result.value });
    });
    });
  });
  return Response.json({ ok: true, queued: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
