import twilio from "twilio";

export type TwilioChannel = "whatsapp" | "facebook";

export function normalizeTwilioMessage(params: Record<string, string>) {
  const channel: TwilioChannel | null = params.From?.startsWith("whatsapp:") ? "whatsapp"
    : params.From?.startsWith("messenger:") ? "facebook" : null;
  const prefix = channel === "whatsapp" ? "whatsapp:" : "messenger:";
  if (!channel || !params.MessageSid || !params.To?.startsWith(prefix)) return null;
  const customerId = params.From.slice(prefix.length);
  const pageId = params.To.slice(prefix.length);
  if (!customerId || !pageId) return null;
  const mediaCount = Number(params.NumMedia || 0);
  return {
    channel, customerId, pageId, messageId: params.MessageSid,
    customerName: params.ProfileName || customerId,
    body: params.Body || (mediaCount > 0 ? `[${mediaCount} attachment(s)]` : "[Message]"),
    messageType: mediaCount > 0 ? "attachment" : "text",
  };
}

export function verifyTwilioSignature(token: string, signature: string | null, url: string, params: Record<string, string>) {
  return Boolean(token && signature && twilio.validateRequest(token, signature, url, params));
}

export function twilioClient(accountSid: string, authToken: string) {
  return twilio(accountSid, authToken, { autoRetry: false, timeout: 15000 });
}
