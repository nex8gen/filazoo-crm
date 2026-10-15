import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { saveEmailInboxState } from "@/lib/data/email-state";

const stateSchema = z.object({
  messageKey: z.string().trim().min(1).max(512),
  category: z.enum(["Needs follow-up", "Waiting on customer", "Interested", "Big order", "No action"]).nullable(),
  starred: z.boolean(),
  folder: z.enum(["inbox", "archive", "trash"]),
  followUpAt: z.string().datetime().nullable(),
});

export async function POST(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "viewer"]);
  const parsed = stateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid email state." }, { status: 400 });
  }
  try {
    await saveEmailInboxState(viewer.id, parsed.data);
    return Response.json({ ok: true, state: parsed.data }, { status: 200 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unable to save email state." }, { status: 500 });
  }
}
