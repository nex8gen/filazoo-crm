import { env } from "@/lib/env";
import { verifyTracking } from "@/lib/flow-tracking";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const payload = env.supabaseSecretKey && verifyTracking(new URL(request.url).searchParams.get("token") || "", env.supabaseSecretKey);
  if (!payload) return new Response("Invalid tracking link", { status: 400 });
  const admin = createSupabaseAdmin();
  const { data: run, error } = await admin.from("flow_runs").select("id,flow_id").eq("id", payload.runId).maybeSingle();
  if (error) return new Response("Tracking unavailable", { status: 503 });
  if (!run) return new Response("Tracking link expired", { status: 404 });
  const { error: logError } = await admin.from("flow_run_logs").insert({ run_id: run.id, result: { action: payload.kind === "open" ? "email_opened" : "link_clicked", stepId: payload.stepId, target: payload.target ?? null } });
  if (logError) return new Response("Tracking unavailable", { status: 503 });
  const headers = { "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer" };
  if (payload.kind === "click") return new Response(null, { status: 302, headers: { ...headers, Location: payload.target! } });
  return new Response(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"), { headers: { ...headers, "Content-Type": "image/gif" } });
}
