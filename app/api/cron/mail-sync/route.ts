import { runMailSyncWorker, withMailSyncWorkerLease } from "@/lib/data/mail-sync-worker";
import { after } from "next/server";
import { processAutomaticConversationTags } from "@/lib/data/conversation-tagging";
import { forEachWorkspace } from "@/lib/data/workspace-runtime";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const task = new URL(request.url).searchParams.get("task");
  if (task === "health") return Response.json({ ok: true, version: "mail-sync-fast-v4" }, { headers: { "Cache-Control": "no-store" } });
  if (task === "tags") {
    const tags = await forEachWorkspace((_id, count) => processAutomaticConversationTags({ maxConversations: 10, budgetMs: Math.max(5_000, Math.floor(220_000 / count)) }));
    return Response.json({ ok: true, tags }, { headers: { "Cache-Control": "no-store" } });
  }
  if (task === "once") {
    const workspaces = await forEachWorkspace(async (_id, count) => ({
      result: await runMailSyncWorker({ budgetMs: Math.max(5_000, Math.floor(120_000 / count)) }),
      tags: await processAutomaticConversationTags({ maxConversations: 3 }),
    }));
    return Response.json({ ok: true, workspaces }, { headers: { "Cache-Control": "no-store" } });
  }
  // A long HTTP response holds pg_net's shared batch open. Acknowledge the
  // authenticated tick immediately; Next/Vercel keeps after() work alive.
  // Durable account leases prevent competing ticks from syncing one mailbox.
  after(async () => {
    await forEachWorkspace(async (_id, count) => {
    const results = await Promise.allSettled([
      withMailSyncWorkerLease(() => runMailSyncWorker({ budgetMs: Math.max(5_000, Math.floor(280_000 / count)), maxJobs: 2048, waitForWork: true })),
      processAutomaticConversationTags({ maxConversations: 3 }),
    ]);
    for (const result of results) if (result.status === "rejected") console.error("Mailbox background processing failed; durable work will retry.");
    });
  });
  return Response.json({ ok: true, queued: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
