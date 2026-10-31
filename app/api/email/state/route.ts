import { emailInboxStateSchema } from "@/lib/email-inbox-state";
import { isCustomerTag } from "@/lib/customer-tags";
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
    if (parsed.data.categoryWrite && parsed.data.category !== null && !isCustomerTag(parsed.data.category)) return Response.json({ ok: false, error: "Choose one of the ten customer tags." }, { status: 400 });
    if (viewer.role === "viewer" && parsed.data.categoryWrite) return Response.json({ ok: false, error: "Read-only users cannot change customer tags." }, { status: 403 });
    if (viewer.role === "viewer" && parsed.data.provider?.destination) return Response.json({ ok: false, error: "Read-only users cannot move provider emails." }, { status: 403 });
    if (parsed.data.provider && (parsed.data.provider.read !== undefined || parsed.data.provider.starred !== undefined || parsed.data.provider.destination !== undefined)) {
      const { syncProviderState } = await import("@/lib/data/email-provider-state");
      await syncProviderState(viewer, parsed.data.messageKey, parsed.data.provider);
    }
    const saved = await saveEmailInboxState(viewer.id, parsed.data);
    let automation: Awaited<ReturnType<typeof enrollMatchingFlows>> = [];
    if (saved.categoryChanged && parsed.data.category) {
      const { data: contact } = parsed.data.contactEmail
        ? await createSupabaseAdmin().from("contacts").select("id,company_id").eq("email", parsed.data.contactEmail).maybeSingle()
        : { data: null };
      automation = await enrollMatchingFlows({ type: "category_changed", conversationId: parsed.data.threadId || parsed.data.messageKey, messageKey: parsed.data.tagMessageKey ?? parsed.data.messageKey, contactId: contact?.id ?? null, companyId: contact?.company_id ?? null, category: parsed.data.category });
    }
    return Response.json({ ok: true, state: parsed.data, automation }, { status: 200 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unable to save email state." }, { status: 500 });
  }
}
