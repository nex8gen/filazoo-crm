import { normalizeMetaPayload, saveInboundMetaMessage, verifyMetaSignature } from "@/lib/meta-messenger";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  return Response.json({ error: "Verification failed" }, { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = process.env.META_WEBHOOK_SECRET || process.env.META_VERIFY_TOKEN;
  const signature = request.headers.get("x-hub-signature-256");

  if (secret && !verifyMetaSignature(secret, rawBody, signature)) {
    return Response.json({ error: "Invalid signature" }, { status: 403 });
  }

  try {
    const payload = JSON.parse(rawBody);
    const messages = normalizeMetaPayload(payload);

    let saved = 0;
    for (const message of messages) {
      const result = await saveInboundMetaMessage(message);
      if (result.ok && result.saved) saved += 1;
    }

    if (messages.length > 0) {
      console.info("Meta webhook messages received", { total: messages.length, saved });
    }

    return Response.json({ ok: true, received: messages.length, saved }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
}
