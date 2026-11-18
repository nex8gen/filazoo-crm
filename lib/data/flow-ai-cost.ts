import "server-only";
import type { createSupabaseAdmin } from "../supabase/admin.ts";
import { resolveGatewayTokenAsync } from "../ai/provider-credentials.ts";
import type { EmailPerformanceLog } from "../flow-email-performance.ts";
import type { JsonConfig } from "../flows.ts";

/** Billing arrives asynchronously. Persist confirmed charges, and rotate bounded pending lookups. */
export async function reconcileFlowAiCosts(client: ReturnType<typeof createSupabaseAdmin>, logs: EmailPerformanceLog[], now = new Date(), fetcher = fetch) {
  const pending = logs.filter(log => log.result?.action === "ai_usage" && typeof log.result.generationId === "string" && /^gen_[a-zA-Z0-9]+$/.test(log.result.generationId) && log.result.costUsd == null && log.result.costLookupUnavailable !== true && (!log.result.costCheckedAt || now.getTime() - Date.parse(String(log.result.costCheckedAt)) >= 300_000))
    .sort((a, b) => Date.parse(String(a.result?.costCheckedAt || a.created_at)) - Date.parse(String(b.result?.costCheckedAt || b.created_at))).slice(0, 20);
  if (!pending.length) return;
  const token = await resolveGatewayTokenAsync(process.env).catch(() => null);
  if (!token) return;
  for (let offset = 0; offset < pending.length; offset += 5) await Promise.all(pending.slice(offset, offset + 5).map(async log => {
    const result: JsonConfig = { ...log.result!, costCheckedAt: now.toISOString() };
    try {
      const response = await fetcher(`https://ai-gateway.vercel.sh/v1/generation?id=${encodeURIComponent(String(result.generationId))}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const { data } = await response.json();
        if (data?.id === result.generationId && typeof data.total_cost === "number" && Number.isFinite(data.total_cost) && data.total_cost >= 0) {
          result.costUsd = data.total_cost;
          result.costExternal = data.is_byok === true;
        }
      } else if (response.status === 404 && now.getTime() - Date.parse(log.created_at) > 36 * 86_400_000) result.costLookupUnavailable = true;
    } catch { /* Keep missing billing pending; never turn a lookup failure into a zero charge. */ }
    try {
      const { error } = await client.from("flow_run_logs").update({ result }).eq("id", log.id).eq("result->>action", "ai_usage").is("result->>costUsd", null);
      if (!error) log.result = result;
    } catch { /* Email metrics remain available if billing persistence is temporarily unavailable. */ }
  }));
}
