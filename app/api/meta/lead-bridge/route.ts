import { bridgeLeadRow, bridgeLeadSchema, getBridgeSecret, verifyBridgeAuthorization } from "@/lib/meta-lead-bridge";
import { env, hasSupabaseConfig } from "@/lib/env";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { enrollNewLeadFlows } from "@/lib/data/flow-runtime";

export async function POST(request: Request) {
  const secret = getBridgeSecret(env.supabaseSecretKey, process.env.META_LEAD_BRIDGE_SECRET);
  const respond = (body: object, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!secret || secret.length < 32 || !hasSupabaseConfig()) return respond({ error: "Lead connection is not configured." }, 503);
  if (!verifyBridgeAuthorization(request.headers.get("authorization"), secret)) return respond({ error: "Unauthorized." }, 401);

  // Bound the actual stream, including requests without a Content-Length header.
  const reader = request.body?.getReader();
  if (!reader) return respond({ error: "A JSON body is required." }, 400);
  let raw = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 128_000) {
        await reader.cancel();
        return respond({ error: "Payload too large." }, 413);
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch {
    return respond({ error: "Unable to read request." }, 400);
  }
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return respond({ error: "Invalid JSON." }, 400); }
  const parsed = bridgeLeadSchema.safeParse(input);
  if (!parsed.success) return respond({ error: "Invalid lead. Check the field mapping.", issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) }, 400);

  try {
    const admin = createSupabaseAdmin();
    // Both the native webhook and Make use Meta's original lead ID. Conflicting
    // deliveries never overwrite a lead's answers or an operator's assignment.
    const { data, error } = await admin.from("meta_leads").upsert(bridgeLeadRow(parsed.data), {
      onConflict: "leadgen_id", ignoreDuplicates: true,
    }).select("leadgen_id,company_id,contact_id");
    if (error) throw error;
    if (!data?.length) return respond({ ok: true, duplicate: true, leadId: parsed.data.lead_id }, 200);
    // The database creates/matches company, contact and pipeline atomically.
    if (data[0].contact_id) await enrollNewLeadFlows(data[0].contact_id);
    return respond({ ok: true, duplicate: false, leadId: parsed.data.lead_id, companyId: data[0].company_id, contactId: data[0].contact_id }, 201);
  } catch {
    // Let Make retry failures; never return form answers or credentials in errors.
    return respond({ error: "Unable to save lead. Retry the delivery." }, 500);
  }
}
