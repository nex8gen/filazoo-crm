import { sendMetaTextMessage } from "@/lib/meta-messenger";
import type { MetaChannel } from "@/lib/meta-messenger";
import { requireWorkspaceMember } from "@/lib/auth";

export async function POST(request: Request) {
  await requireWorkspaceMember(["admin", "operator"]);
  const payload = await request.json().catch(() => null);
  const to = typeof payload?.to === "string" ? payload.to : "";
  const text = typeof payload?.message === "string" ? payload.message : "";
  const channel: MetaChannel = payload?.channel === "instagram" ? "instagram" : "facebook";

  if (!to || !text) {
    return Response.json({ error: "Missing 'to' or 'message' field." }, { status: 400 });
  }

  const result = await sendMetaTextMessage({
    to,
    text,
    channel,
  });

  if (!result.ok) {
    return Response.json({ error: result.error || "Meta message could not be sent." }, { status: 500 });
  }

  return Response.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
}
