import { z } from "zod";
import { after } from "next/server";
import { requireWorkspaceMember } from "@/lib/auth";
import { approveAutoReplyShipping, enableAutoReply, readAutoReplySetting, getAutoReply, presentAutoReply, stopAutoReply } from "@/lib/data/email-auto-reply";
import { isAutoReplySchemaMissing } from "@/lib/email-auto-reply";

export const maxDuration = 240;
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable"), mailboxId: z.uuid(), senderId: z.uuid(), messageId: z.string().min(1).max(1000), revision: z.number().int().min(0) }),
  z.object({ action: z.literal("stop"), id: z.uuid() }),
  z.object({ action: z.literal("shipping"), id: z.uuid(), revision: z.number().int().positive(), shippingMinor: z.number().int().min(0).max(100_000_000) }),
]);
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const params = new URL(request.url).searchParams;
  try {
    const id = params.get("id");
    if (id) {
      if (!z.uuid().safeParse(id).success) throw new Error("Invalid automation ID.");
      return Response.json({ ok: true, automation: presentAutoReply(await getAutoReply(viewer, id)) }, { headers });
    }
    const mailboxId = params.get("mailboxId"), messageId = params.get("messageId");
    if (!z.uuid().safeParse(mailboxId).success || !messageId || messageId.length > 1000) throw new Error("Select a received email in a connected mailbox.");
    const references = z.array(z.string().min(1).max(1000)).max(100).safeParse(JSON.parse(params.get("references") || "[]"));
    if (!references.success) throw new Error("Invalid conversation references.");
    const row = await readAutoReplySetting(viewer, mailboxId!, [messageId, ...references.data]);
    return Response.json({ ok: true, automation: presentAutoReply(row) }, { headers });
  } catch (error) {
    if (isAutoReplySchemaMissing(error as { code?: string; message?: string })) return Response.json({ error: "AI auto-reply database setup is pending." }, { status: 503, headers });
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load AI automation." }, { status: 400, headers });
  }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid automation action." }, { status: 400 });
  try {
    const input = parsed.data;
    const row = input.action === "enable" ? await enableAutoReply(viewer, input)
      : input.action === "stop" ? await stopAutoReply(viewer, input.id)
        : await approveAutoReplyShipping(viewer, input.id, input.revision, input.shippingMinor);
    if (input.action === "shipping") after(async () => {
      const { processEmailAutoReply } = await import("@/lib/data/email-auto-reply-worker");
      await processEmailAutoReply(row.id);
    });
    return Response.json({ ok: true, automation: presentAutoReply(row) }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update AI automation." }, { status: 409, headers });
  }
}
