import "server-only";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import type { WorkspaceViewer } from "../auth.ts";
import type { NormalizedMailboxRecord } from "../mailbox-utils.ts";
import type { FollowupActionRecord } from "../email-followup-filters.ts";
import { allFlowActions } from "../flow-engine.ts";
import type { FlowInput, JsonConfig } from "../flows.ts";
import { resolveFlowSender } from "../flow-mailboxes.ts";
import { getViewerMailboxes } from "./mailboxes.ts";

export type DormantCustomer = { company_id: string; contact_id: string; last_activity_at: string; eligible: boolean };

/** The database returns activity dates, never another salesperson's private mail. */
export async function dormantCustomers(userId: string, months: number, options: { companyId?: string; after?: string } = {}) {
  const { data, error } = await createSupabaseAdmin().rpc("crm_dormant_customers", {
    p_user_id: userId, p_months: months, p_company_id: options.companyId || null, p_after: options.after || null,
  });
  if (error) throw new Error(`Unable to check inactive customers: ${error.message}`);
  return (data || []) as DormantCustomer[];
}

export async function dormantRunEligible(userId: string, months: number, companyId: string | null, baseline: string) {
  if (!companyId || !Number.isFinite(Date.parse(baseline))) return false;
  const customer = (await dormantCustomers(userId, months, { companyId }))[0];
  return Boolean(customer?.eligible && Date.parse(customer.last_activity_at) === Date.parse(baseline));
}

export async function listDormantActions(viewer: WorkspaceViewer, mailbox: Pick<NormalizedMailboxRecord, "id">, authorizedMailboxes?: Awaited<ReturnType<typeof getViewerMailboxes>>): Promise<FollowupActionRecord[]> {
  const db = createSupabaseAdmin();
  const mailboxes = authorizedMailboxes ?? await getViewerMailboxes(viewer.id, true);
  const { data: flows } = await db.from("flows").select("id,status").eq("user_id", viewer.id).eq("trigger_type", "dormant_customer").throwOnError();
  if (!flows.length) return [];
  const actions: FollowupActionRecord[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data: runs } = await db.from("flow_runs").select("id,flow_id,company_id,status,next_run_at,started_at,finished_at,current_step,context").in("flow_id", flows.map(flow => flow.id)).order("id").range(offset, offset + 499).throwOnError();
    for (const run of runs) {
      if (!run.company_id || typeof run.context?.definition !== "string") continue;
      let steps: FlowInput["steps"];
      try { steps = JSON.parse(run.context.definition); } catch { continue; }
      const email = allFlowActions(steps).find(step => step.type === "ai_auto_reply");
      const sender = resolveFlowSender(mailboxes, viewer.id, email?.config.mailboxId);
      if (sender?.id !== mailbox.id) continue;
      const current = steps[run.current_step];
      const next = steps.slice(run.current_step).find(step => step.type === "ai_auto_reply");
      const position = next ? allFlowActions(steps).filter(step => step.type === "ai_auto_reply").findIndex(step => step.id === next.id) + 1 : 0;
      const total = allFlowActions(steps).filter(step => step.type === "ai_auto_reply").length;
      const context = run.context as JsonConfig;
      const paused = run.status === "active" && flows.find(flow => flow.id === run.flow_id)?.status !== "live";
      actions.push({ id: run.id, source: "workflow", kind: "ai", purpose: "nurture", companyId: run.company_id,
        status: run.status === "done" ? "sent" : run.status === "cancelled" ? "cancelled" : paused ? "paused" : run.status === "failed" || context.executionState === "blocked" ? "failed" : "scheduled",
        dueAt: !paused && run.next_run_at || undefined, threadKey: String(context.emailThreadId || `company:${run.company_id}`), anchors: [],
        updatedAt: run.finished_at || run.started_at, progress: position && current ? `${position}/${total}` : undefined });
    }
    if (runs.length < 500) break;
  }
  return actions;
}
