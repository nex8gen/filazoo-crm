import { sendMetaTextMessage } from "@/lib/meta-messenger";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const to = typeof payload?.to === "string" ? payload.to : "";
  const text = typeof payload?.message === "string" ? payload.message : "";

  if (!to || !text) {
    return Response.json({ error: "Missing 'to' or 'message' field." }, { status: 400 });
  }

  const result = await sendMetaTextMessage({
    to,
    text,
    accessToken: process.env.META_ACCESS_TOKEN,
    phoneNumberId: process.env.META_PHONE_NUMBER_ID,
  });

  if (!result.ok) {
    return Response.json({ error: result.error || "Meta message could not be sent." }, { status: 500 });
  }

  return Response.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
}
