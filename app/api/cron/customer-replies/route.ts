import { processCustomerReplies } from "@/lib/data/customer-reply-worker";
import { processTaskWorkflows } from "@/lib/data/task-workflows";
import { withMailboxSyncSessions } from "@/lib/mailbox-imap";
export const maxDuration = 240;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ ok: false }, { status: 401 });
  if (new URL(request.url).searchParams.get("task") === "health") return Response.json({ ok: true, version: "customer-replies-v1" }, { headers: { "Cache-Control": "no-store" } });
  const { result, work } = await withMailboxSyncSessions(async () => ({
    result: await processCustomerReplies({ budgetMs: 90_000 }),
    work: await processTaskWorkflows({ maxJobs: 2, budgetMs: 90_000 }),
  }));
  return Response.json({ ok: true, ...result, work }, { headers: { "Cache-Control": "no-store" } });
}
