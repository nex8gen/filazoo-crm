import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { ownerOrder, workspaceSubscription } from "@/lib/billing/data";
import { workspaceCookie, workspaceCookieOptions } from "@/lib/workspaces";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try {
    const parsed = new URL(origin || "");
    sameOrigin = parsed.origin === origin && ["http:", "https:"].includes(parsed.protocol)
      && parsed.host === request.headers.get("host");
  } catch { /* Missing or malformed origins fail closed. */ }
  if (!sameOrigin) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Please sign in." }, { status: 401, headers });
  const order = await ownerOrder(viewer.id, (await context.params).id);
  if (!order) return Response.json({ error: "Payment not found." }, { status: 404, headers });
  const subscription = await workspaceSubscription(order.workspace_id);
  if (order.status !== "paid" || !(subscription.activePlan || subscription.grandfathered)) return Response.json({ error: "Payment is not active." }, { status: 409, headers });
  const response = NextResponse.json({ success: true }, { headers });
  response.cookies.set(workspaceCookie, order.workspace_id, workspaceCookieOptions());
  return response;
}
