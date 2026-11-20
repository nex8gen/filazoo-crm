import { getViewer } from "@/lib/auth";
import { ownerOrder } from "@/lib/billing/data";
import { checkoutUrl } from "@/lib/billing/alipay";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "Content-Type": "text/plain; charset=utf-8" };
  const viewer = await getViewer();
  if (!viewer) return new Response("Please sign in to pay.", { status: 401, headers });
  try {
    const order = await ownerOrder(viewer.id, (await context.params).id);
    if (!order) return new Response("Payment not found.", { status: 404, headers });
    return new Response(null, { status: 302, headers: { ...headers, Location: checkoutUrl(order) } });
  } catch { return new Response("This checkout is unavailable or has expired. Return to subscriptions to continue.", { status: 409, headers }); }
}
