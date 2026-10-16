import {
  getShopifyWebhookConfig,
  hasShopifyLeadTag,
  normalizeShopifyCustomer,
  saveShopifyLead,
  verifyShopifySignature,
} from "@/lib/shopify-leads";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const config = getShopifyWebhookConfig();
  if (!config.secret || !config.storeDomain) {
    return Response.json({ error: "Shopify webhook integration is not configured." }, { status: 503 });
  }
  if (!verifyShopifySignature(config.secret, rawBody, request.headers.get("x-shopify-hmac-sha256"))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const shopDomain = request.headers.get("x-shopify-shop-domain")?.trim().toLowerCase();
  if (shopDomain !== config.storeDomain) {
    return Response.json({ error: "Unexpected Shopify store" }, { status: 403 });
  }
  const topic = request.headers.get("x-shopify-topic")?.trim().toLowerCase();
  if (topic !== "customers/create") {
    return Response.json({ error: "Unsupported Shopify webhook topic" }, { status: 422 });
  }
  const webhookId = request.headers.get("x-shopify-webhook-id")?.trim();
  if (!webhookId) return Response.json({ error: "Missing Shopify webhook ID" }, { status: 400 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
  const lead = normalizeShopifyCustomer(payload);
  if (!lead) return Response.json({ error: "Shopify customer email and ID are required" }, { status: 422 });
  if (!hasShopifyLeadTag(lead.tags, config.requiredTag)) {
    return Response.json({ ok: true, ignored: true, reason: "Customer is not tagged as a B2B form lead." });
  }

  const result = await saveShopifyLead(lead, webhookId, shopDomain);
  if (!result.ok) {
    console.error("Shopify B2B lead could not be imported", { webhookId, customerId: lead.customerId, error: result.error });
    return Response.json({ error: "Shopify lead import failed" }, { status: 500 });
  }
  return Response.json({ ok: true, duplicate: result.duplicate, companyId: result.companyId, contactId: result.contactId }, {
    headers: { "Cache-Control": "no-store" },
  });
}
