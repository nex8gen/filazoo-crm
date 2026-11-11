import "server-only";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { flowInputSchema } from "../flows.ts";
import { validateFlowResources } from "./flow-runtime.ts";
import { normalizeMailboxRows } from "../mailbox-utils.ts";
import { verifyMailboxSmtp } from "../mailer.ts";
import { requireFreshFlowMailbox } from "./flow-mail-context.ts";

/** Scheduler-authenticated preflight. Authenticates providers but never sends. */
export async function checkWorkspaceFlowHealth() {
  const db = createSupabaseAdmin();
  const [{ data: flows }, { data: steps }, { data: rows }] = await Promise.all([
    db.from("flows").select("id,user_id,name,status,trigger_type,trigger_config").eq("status", "live").throwOnError(),
    db.from("flow_steps").select("flow_id,position,type,config").order("position").throwOnError(),
    db.from("workspace_mailboxes").select("*").eq("is_active", true).throwOnError(),
  ]);
  const checks = await Promise.all((flows ?? []).map(async flow => {
    try {
      await validateFlowResources(flow.user_id, flowInputSchema.parse({ name: flow.name, status: flow.status, triggerType: flow.trigger_type, triggerConfig: flow.trigger_config,
        steps: (steps ?? []).filter(step => step.flow_id === flow.id) }));
      return { flowId: flow.id, ready: true };
    } catch (error) { return { flowId: flow.id, ready: false, error: error instanceof Error ? error.message : "Workflow preflight failed." }; }
  }));
  const mailboxes = await Promise.all(normalizeMailboxRows(rows).map(async box => {
    try {
      await verifyMailboxSmtp({ host: box.smtpHost, port: box.smtpPort, user: box.smtpUsername, pass: box.smtpPassword, from: box.email }, { timeoutMs: 7_000 });
      await requireFreshFlowMailbox(box.id, box.userId || "scheduler");
      return { mailboxId: box.id, ready: true };
    } catch (error) { return { mailboxId: box.id, ready: false, error: error instanceof Error ? error.message : "Mailbox preflight failed." }; }
  }));
  return { checks, mailboxes, ready: [...checks, ...mailboxes].every(check => check.ready) };
}
