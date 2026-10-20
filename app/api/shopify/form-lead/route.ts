import {
  getShopifyFormConfig,
  normalizeShopifyFormLead,
  saveShopifyLead,
} from "@/lib/shopify-leads";

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

export async function POST(request: Request) {
  const config = getShopifyFormConfig();
  const origin = request.headers.get("origin");
  if (origin !== config.origin) {
    return Response.json({ error: "Unexpected form origin" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form payload" }, { status: 400, headers: corsHeaders(config.origin) });
  }
  if (formData.get("crm_form_id") !== config.formId) {
    return Response.json({ error: "Unexpected form ID" }, { status: 403, headers: corsHeaders(config.origin) });
  }
  if (String(formData.get("company_website_confirm") ?? "").trim()) {
    return Response.json({ ok: true, ignored: true }, { headers: corsHeaders(config.origin) });
  }

  const lead = normalizeShopifyFormLead(formData, request.headers);
  if (!lead) {
    return Response.json({ error: "Name, business, email, and submission ID are required" }, { status: 422, headers: corsHeaders(config.origin) });
  }
  const submissionId = lead.customerId.slice("form:".length);
  const result = await saveShopifyLead(lead, `form:${submissionId}`, "filazoo.com");
  if (!result.ok) {
    console.error("Shopify B2B form lead could not be imported", { submissionId, error: result.error });
    return Response.json({ error: "Shopify form lead import failed" }, { status: 500, headers: corsHeaders(config.origin) });
  }
  return Response.json({ ok: true, duplicate: result.duplicate }, { headers: corsHeaders(config.origin) });
}
