import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const viewer = await requireWorkspaceMember();
  const { data, error } = await createSupabaseAdmin().from("email_reply_knowledge").select("id,title,content").order("created_at");
  if (error) return Response.json({ error: "Unable to load approved business facts." }, { status: 500 });
  return Response.json({ ok: true, facts: data, canManage: ["admin", "operator"].includes(viewer.role) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const viewer = await requireWorkspaceMember(["admin", "operator"]);
  const input = z.object({ title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(10000) }).safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Enter a title and approved policy or business fact." }, { status: 400 });
  const { data, error } = await createSupabaseAdmin().from("email_reply_knowledge").insert({ ...input.data, created_by: viewer.id }).select("id,title,content").single();
  if (error) return Response.json({ error: "Unable to save this business fact." }, { status: 500 });
  return Response.json({ ok: true, fact: data });
}

export async function DELETE(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  await requireWorkspaceMember(["admin", "operator"]);
  const id = new URL(request.url).searchParams.get("id");
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid business fact." }, { status: 400 });
  const { error } = await createSupabaseAdmin().from("email_reply_knowledge").delete().eq("id", id);
  if (error) return Response.json({ error: "Unable to delete this business fact." }, { status: 500 });
  return Response.json({ ok: true });
}
