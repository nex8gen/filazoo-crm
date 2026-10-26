import { env } from "@/lib/env";
import { saveMetaMessage } from "@/lib/meta-messenger";
import { normalizeTwilioMessage, verifyTwilioSignature } from "@/lib/twilio-messaging";

export async function POST(request: Request) {
  if (!env.TWILIO_AUTH_TOKEN || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_WEBHOOK_URL) {
    return Response.json({ error: "Twilio webhook is not configured." }, { status: 503 });
  }
  if (!request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
    return Response.json({ error: "Expected form data." }, { status: 415 });
  }
  const params = Object.fromEntries(new URLSearchParams(await request.text()));
  if (!verifyTwilioSignature(env.TWILIO_AUTH_TOKEN, request.headers.get("x-twilio-signature"), env.TWILIO_WEBHOOK_URL, params)
    || params.AccountSid !== env.TWILIO_ACCOUNT_SID) {
    return Response.json({ error: "Invalid signature." }, { status: 403 });
  }
  const message = normalizeTwilioMessage(params);
  const sender = message?.channel === "whatsapp" ? env.TWILIO_WHATSAPP_FROM : env.TWILIO_FACEBOOK_FROM;
  if (!message || params.To !== sender) return Response.json({ error: "Unknown sender." }, { status: 400 });
  const saved = await saveMetaMessage({
    messageId: message.messageId, threadId: message.customerId, pageId: message.pageId,
    senderId: message.customerId, recipientId: message.pageId, customerName: message.customerName,
    direction: "inbound", body: message.body, messageType: message.messageType,
    status: "received", createdAt: new Date().toISOString(), rawPayload: params, channel: message.channel,
  }, true);
  if (!saved.ok) return Response.json({ error: "Message could not be stored." }, { status: 500 });
  return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>", {
    headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
  });
}
