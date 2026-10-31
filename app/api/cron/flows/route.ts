import { processDueFlowRuns } from "@/lib/data/flow-runtime";
import { env } from "@/lib/env";
import { after } from "next/server";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const task = new URL(request.url).searchParams.get("task");
  if (task === "health") return Response.json({ ok: true, liveSending: !env.dryRun, version: "flow-live-v2" }, { headers: { "Cache-Control": "no-store" } });
  after(async () => {
    try { const { processAutomaticConversationTags } = await import("@/lib/data/conversation-tagging"); await processAutomaticConversationTags({ maxConversations: 3 }); }
    catch { console.error("Automatic conversation tagging will retry on the next background tick."); }
  });
  const [{ processScheduledEmails }, { deliverEmail }] = await Promise.all([import("@/lib/data/email-delivery"), import("@/lib/data/manual-email-send")]);
  const scheduledEmailsProcessed = await processScheduledEmails(deliverEmail);
  const results = await processDueFlowRuns(50, { syncMailbox: task !== "resume" });
  const { processEmailAutoReplies } = await import("@/lib/data/email-auto-reply-worker");
  const automaticRepliesChecked = await processEmailAutoReplies();
  return Response.json({ ok: true, processed: results.length, results, automaticRepliesChecked, scheduledEmailsProcessed }, { headers: { "Cache-Control": "no-store" } });
}
