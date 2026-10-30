import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { data, error } = await createSupabaseAdmin().from("email_send_operations").select("id,payload,status,scheduled_at,error,updated_at").eq("user_id", viewer.id).in("status", ["scheduled", "preparing", "submitting", "failed", "uncertain"]).order("scheduled_at", { ascending: true }).limit(100);
  if (error) return Response.json({ error: "Unable to load scheduled emails." }, { status: 503 });
  return Response.json({ emails: data || [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const { id } = await request.json().catch(() => ({}));
  if (typeof id !== "string") return Response.json({ error: "Invalid scheduled email." }, { status: 400 });
  const { data, error } = await createSupabaseAdmin().from("email_send_operations").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("user_id", viewer.id).eq("id", id).in("status", ["scheduled", "failed"]).select("id").maybeSingle();
  if (error || !data) return Response.json({ error: "This email has already started sending or could not be cancelled. Refresh its status." }, { status: 409 });
  return Response.json({ ok: true });
}
