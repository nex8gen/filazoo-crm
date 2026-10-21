import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { saveEmailInboxState } from "@/lib/data/email-state";
import { enrollMatchingFlows } from "@/lib/data/flow-runtime";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

const stateSchema = z.object({
  messageKey: z.string().trim().min(1).max(512),
  category: z.enum(["Needs follow-up", "Waiting on customer", "Interested", "Big order", "No action"]).nullable(),
  starred: z.boolean(),
  read: z.boolean(),
  folder: z.enum(["inbox", "archive", "trash"]),
  followUpAt: z.string().datetime().nullable(),
  contactEmail: z.string().trim().email().optional(),
  threadId: z.string().trim().max(512).nullable().optional(),
});

export async function POST(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const parsed = stateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid email state." }, { status: 400 });
  }
  try {
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
