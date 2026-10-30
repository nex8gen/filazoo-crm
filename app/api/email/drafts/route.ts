import { requireWorkspaceMember } from "@/lib/auth";
import { getViewerMailbox } from "@/lib/data/mailboxes";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { emailDraftSchema } from "@/lib/email-workbench";

export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const mailboxId = new URL(request.url).searchParams.get("mailboxId");
  if (!mailboxId || !await getViewerMailbox(viewer.id, mailboxId)) return Response.json({ error: "Mailbox unavailable." }, { status: 404 });
  const { data, error } = await createSupabaseAdmin().from("email_workbench_drafts").select("payload").eq("user_id", viewer.id).eq("mailbox_id", mailboxId).is("deleted_at", null).order("updated_at", { ascending: false }).limit(100);
  if (error) return Response.json({ error: "Unable to load saved drafts." }, { status: 503 });
  return Response.json({ drafts: (data || []).map((row) => row.payload) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const parsed = emailDraftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid draft." }, { status: 400 });
  const draft = parsed.data;
  if (!await getViewerMailbox(viewer.id, draft.mailboxId)) return Response.json({ error: "Mailbox unavailable." }, { status: 404 });
  const { data, error } = await createSupabaseAdmin().rpc("save_email_workbench_draft", { p_user: viewer.id, p_id: draft.id, p_mailbox: draft.mailboxId, p_revision: draft.revision, p_payload: draft });
  if (error) return Response.json({ error: "Draft is stored on this device. Server save failed; retry before leaving." }, { status: 503 });
  return Response.json({ saved: data });
}

export async function DELETE(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const value = await request.json().catch(() => null);
  if (typeof value?.id !== "string" || typeof value?.mailboxId !== "string" || !await getViewerMailbox(viewer.id, value.mailboxId)) return Response.json({ error: "Draft unavailable." }, { status: 404 });
  const { error } = await createSupabaseAdmin().rpc("save_email_workbench_draft", { p_user: viewer.id, p_id: value.id, p_mailbox: value.mailboxId, p_revision: Date.now() * 1000, p_payload: {}, p_deleted: true });
  if (error) return Response.json({ error: "Unable to discard this draft." }, { status: 503 });
  return Response.json({ ok: true });
}
