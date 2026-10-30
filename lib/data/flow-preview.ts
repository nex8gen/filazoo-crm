import "server-only";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { loadFlowFacts } from "./flow-runtime.ts";
import { matchesFlowCustomer, matchesFlowScope, matchesProfileFilters, simulateFlow } from "../flow-engine.ts";
import { flowScenarioSchema } from "../flow-email-test.ts";
import { triggerLabels } from "../flows.ts";
import type { FlowPreviewInput, FlowPreviewResult } from "../flow-preview.ts";

/** Read-only preview. The trigger is a stated assumption; saved profile and re-entry checks are real. */
export async function previewFlow(input: FlowPreviewInput, userId: string, isAdmin = false): Promise<FlowPreviewResult> {
  const admin = createSupabaseAdmin();
  const { flow } = input;
  const { data: customer } = input.contactId
    ? await admin.from("contacts").select("id,name,email,company_id,unsubscribed,verification_status").eq("id", input.contactId).maybeSingle().throwOnError()
    : { data: null };
  if (input.contactId && !customer) throw new Error("This customer is no longer available.");
  const facts = customer
    ? await loadFlowFacts({ userId, contactId: customer.id, companyId: customer.company_id, since: new Date().toISOString() })
    : flowScenarioSchema.parse(input.scenario ?? {});
  const checks: FlowPreviewResult["checks"] = [
    { label: "Trigger event", passed: null, detail: `Assumes “${triggerLabels[flow.triggerType]}” occurs now.` },
    { label: "Company filters", passed: matchesProfileFilters(flow.triggerConfig, facts), detail: "Checks the current status, stage, segment, country and fit score." },
    { label: "Customer selection", passed: customer ? matchesFlowCustomer(flow.triggerConfig, customer.id) && matchesFlowScope(flow.triggerConfig, customer.company_id, customer.id) : null, detail: customer ? "Checks this customer's company and the flow's selected recipients." : "Choose a saved customer to check recipient restrictions." },
  ];
  const mode = String(flow.triggerConfig.reentryMode || "every_event");
  if (mode === "every_event") checks.push({ label: "Re-entry criteria", passed: true, detail: "Every matching event is allowed; an active conversation run is still deduplicated." });
  else if (!input.flowId || !customer) checks.push({ label: "Re-entry criteria", passed: null, detail: "Save the flow and choose a customer to check previous entries." });
  else {
    const { data: saved } = await admin.from("flows").select("id,user_id").eq("id", input.flowId).maybeSingle().throwOnError();
    if (!saved || (!isAdmin && saved.user_id !== userId)) throw new Error("You cannot inspect this flow's entry history.");
    let query = admin.from("flow_runs").select("id").eq("flow_id", input.flowId).eq("contact_id", customer.id);
    if (mode === "after_period") {
      const duration = Number(flow.triggerConfig.reentryAfterAmount || 1) * (flow.triggerConfig.reentryAfterUnit === "hours" ? 3_600_000 : 86_400_000);
      query = query.gt("started_at", new Date(Date.now() - duration).toISOString());
    }
    const { data: previous } = await query.limit(1).maybeSingle().throwOnError();
    checks.push({ label: "Re-entry criteria", passed: !previous, detail: previous ? "A previous entry prevents this customer from entering now." : "No previous entry prevents this customer from entering now." });
  }
  const enters = checks.every((check) => check.passed !== false);
  const warnings = ["Uses current facts. Future replies, opens and profile changes can change the actual journey."];
  if (customer) warnings.push("Assumes a new entry now, with no later replies, opens or clicks. Use Scenario to explore future engagement.");
  if (customer?.unsubscribed) warnings.push("This customer is unsubscribed. Production email delivery remains blocked.");
  if (customer && customer.verification_status !== "valid") warnings.push("Email verification and suppression are checked again at delivery time.");
  return { ok: true, enters, checks, facts, trace: enters ? simulateFlow(flow, facts).trace : [],
    customer: customer ? { id: customer.id, name: customer.name, email: customer.email, companyId: customer.company_id } : null, warnings };
}
