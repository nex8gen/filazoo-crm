import { emailInboxStateSchema } from "@/lib/email-inbox-state";
import { requireWorkspaceMember } from "@/lib/auth";
import { saveEmailInboxState } from "@/lib/data/email-state";
import { enrollMatchingFlows } from "@/lib/data/flow-runtime";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const parsed = emailInboxStateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid email state." }, { status: 400 });
  }
  try {
    if (viewer.role === "viewer" && parsed.data.provider?.destination) return Response.json({ ok: false, error: "Read-only users cannot move provider emails." }, { status: 403 });
    if (parsed.data.provider) {
      const { syncProviderState } = await import("@/lib/data/email-provider-state");
      await syncProviderState(viewer, parsed.data.messageKey, parsed.data.provider);
    }
    const saved = await saveEmailInboxState(viewer.id, parsed.data);
    let automation: Awaited<ReturnType<typeof enrollMatchingFlows>> = [];
    if (saved.categoryChanged && parsed.data.category) {
      const { data: contact } = parsed.data.contactEmail
        ? await createSupabaseAdmin().from("contacts").select("id,company_id").eq("email", parsed.data.contactEmail).maybeSingle()
        : { data: null };
      automation = await enrollMatchingFlows({ type: "category_changed", conversationId: parsed.data.threadId || parsed.data.messageKey, messageKey: parsed.data.messageKey, contactId: contact?.id ?? null, companyId: contact?.company_id ?? null, category: parsed.data.category });
    }
    return Response.json({ ok: true, state: parsed.data, automation }, { status: 200 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unable to save email state." }, { status: 500 });
  }
}
