import { requireWorkspaceMember } from "@/lib/auth";
import { readCrmReceivedEmail } from "@/lib/data/crm-email-content";
import { downloadMailboxOriginal } from "@/lib/mailbox-imap";

export const maxDuration = 240;
export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = new URL(request.url).searchParams;
  const id = params.get("id") || "";
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) return Response.json({ error: "Invalid message." }, { status: 400 });
  try {
    const result = await readCrmReceivedEmail(viewer, id);
    if (!result) return Response.json({ error: "Message not found." }, { status: 404 });
    if (params.get("format") === "original") {
      if (!result.source) return Response.json({ error: "Original message unavailable." }, { status: 404 });
      const { mailbox, folder, uid, validity } = result.source;
      const bytes = await downloadMailboxOriginal(mailbox, uid, validity, folder);
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "message/rfc822", "Content-Disposition": "attachment; filename=message.eml", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    return Response.json({ email: result.email }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("CRM email content load failed:", error instanceof Error ? error.message : (error as { message?: string })?.message || "Unknown error");
    return Response.json({ error: "Unable to load the original CRM email. Please retry." }, { status: 502 });
  }
}
