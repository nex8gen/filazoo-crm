import { getViewer } from "@/lib/auth";
import { ownerOrder, refreshPayment } from "@/lib/billing/data";
import { alipayReady } from "@/lib/billing/alipay";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Sign in to check this payment." }, { status: 401, headers });
  try {
    let order = await ownerOrder(viewer.id, (await context.params).id);
    if (!order) return Response.json({ error: "Payment not found." }, { status: 404, headers });
    if (alipayReady()) order = await refreshPayment(order);
    return Response.json({ status: order.status, expired: Date.parse(order.expires_at) <= Date.now(), paidUntil: order.period_end }, { headers });
  } catch { return Response.json({ error: "We could not check your payment. Please try again." }, { status: 503, headers }); }
}
