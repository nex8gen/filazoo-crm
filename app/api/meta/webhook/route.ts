import { env } from "@/lib/env";
import { normalizeMetaPayload, saveInboundMetaMessage, saveMetaLead, verifyMetaSignature } from "@/lib/meta-messenger";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (!env.META_VERIFY_TOKEN) {
    return Response.json({ error: "Meta webhook verification is not configured." }, { status: 503 });
  }

  if (mode === "subscribe" && token && token === env.META_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  return Response.json({ error: "Verification failed" }, { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = env.META_WEBHOOK_SECRET;
  const signature = request.headers.get("x-hub-signature-256");

  if (!secret) {
    return Response.json({ error: "Meta webhook signing is not configured." }, { status: 503 });
  }

  if (!verifyMetaSignature(secret, rawBody, signature)) {
    return Response.json({ error: "Invalid signature" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  try {
    const { messages, leads } = normalizeMetaPayload(payload);

    let messagesSaved = 0;
    let processingFailed = false;
    for (const message of messages) {
      const result = await saveInboundMetaMessage(message);
      if (result.ok && result.saved) messagesSaved += 1;
      else {
        processingFailed = true;
        console.error("Facebook Messenger event could not be stored", { messageId: message.id, error: result.error });
      }
    }

    let leadsSaved = 0;
    for (const lead of leads) {
      const result = await saveMetaLead(lead);
      if (result.ok && result.saved) {
        leadsSaved += 1;
        if (!result.detailFetched) console.warn("Facebook lead event stored without form answers", { leadgenId: lead.leadgenId });
      } else {
        processingFailed = true;
        console.error("Facebook Lead Ad event could not be stored", { leadgenId: lead.leadgenId, error: result.error });
      }
    }

    console.info("Meta Page webhook processed", {
      messagesReceived: messages.length,
      messagesSaved,
      leadsReceived: leads.length,
      leadsSaved,
    });

    return Response.json({
      ok: !processingFailed,
      messages: { received: messages.length, saved: messagesSaved },
      leads: { received: leads.length, saved: leadsSaved },
    }, { status: processingFailed ? 500 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Meta Page webhook processing failed", { error: error instanceof Error ? error.message : "Unknown error" });
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
