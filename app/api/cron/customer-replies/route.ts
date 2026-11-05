import { processCustomerReplies } from "@/lib/data/customer-reply-worker";
import { processTaskWorkflows } from "@/lib/data/task-workflows";
import { withMailboxSyncSessions } from "@/lib/mailbox-imap";
import { forEachWorkspace } from "@/lib/data/workspace-runtime";
export const maxDuration = 240;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ ok: false }, { status: 401 });
  if (new URL(request.url).searchParams.get("task") === "health") return Response.json({ ok: true, version: "customer-replies-v1" }, { headers: { "Cache-Control": "no-store" } });
  const workspaces = await forEachWorkspace((_id, count) => withMailboxSyncSessions(async () => ({
    result: await processCustomerReplies({ budgetMs: Math.max(5_000, Math.floor(90_000 / count)) }),
    work: await processTaskWorkflows({ maxJobs: 2, budgetMs: Math.max(5_000, Math.floor(90_000 / count)) }),
  })));
  return Response.json({ ok: true, workspaces }, { headers: { "Cache-Control": "no-store" } });
}
