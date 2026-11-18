import "server-only";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { isEmailScopedFlow, type JsonConfig } from "../flows.ts";
import type { FlowHistoryFilter, FlowHistoryEntry } from "../flow-history.ts";

export async function listFlowHistory(flowId: string, options: { page: number; query: string; kind: FlowHistoryFilter }) {
  const viewer = await requireWorkspaceMember();
  const admin = createSupabaseAdmin();
  const { data: flow, error: flowError } = await admin.from("flows").select("id,trigger_config").eq("id", flowId).maybeSingle();
  if (flowError) throw new Error("Unable to load workflow.");
  if (!flow) throw new Error("Workflow not found.");
  // Match the collection's company-assignment visibility for restricted BDs.
  const scope = (flow.trigger_config ?? {}) as JsonConfig;
  if (viewer.role === "bd_manager" && isEmailScopedFlow(scope)) {
    const { data: assignment, error } = await admin.from("pipeline").select("company_id").eq("company_id", scope.scopeCompanyId).eq("owner_id", viewer.id).maybeSingle();
    if (error) throw new Error("Unable to verify workflow access.");
    if (!assignment) throw new Error("Workflow not found.");
  }
  let query = admin.from("flow_change_history")
    .select("id,version,actor_label,created_at,changes").eq("flow_id", flowId);
  if (options.query) query = query.ilike("summary", `%${options.query.replace(/[\\%_]/g, "\\$&")}%`);
  if (options.kind !== "all") query = query.contains("changes", [{ kind: options.kind }]);
  const { data, error } = await query.order("version", { ascending: false })
    .range(options.page * 25, options.page * 25 + 25);
  if (error) throw new Error("Unable to load flow history.");
  const rows = (data ?? []) as FlowHistoryEntry[];
  return { entries: rows.slice(0, 25), hasMore: rows.length > 25 };
}
