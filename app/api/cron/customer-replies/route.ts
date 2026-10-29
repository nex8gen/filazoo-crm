import { processCustomerReplies } from "@/lib/data/customer-reply-worker";
export const maxDuration = 240;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ ok: false }, { status: 401 });
  if (new URL(request.url).searchParams.get("task") === "health") return Response.json({ ok: true, version: "customer-replies-v1" }, { headers: { "Cache-Control": "no-store" } });
  const result = await processCustomerReplies();
  return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}
