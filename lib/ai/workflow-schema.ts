import { z } from "zod";

const key = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/);
const path = z.array(z.string().regex(/^[A-Za-z0-9_]+$/).refine(value => !["__proto__", "prototype", "constructor"].includes(value) && (!/^\d+$/.test(value) || Number(value) < 100))).min(1).max(8);
export const workflowStepSchema = z.object({
  id: key,
  tool: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/).refine(value => value !== "run_workflow", "Nested workflows are not supported."),
  input: z.record(z.string(), z.unknown()),
  dependsOn: z.array(key).max(20).default([]),
  bindings: z.array(z.object({ path, step: key, result: z.string().regex(/^[A-Za-z]+Id$/) }).strict()).max(12).default([]),
}).strict();
export const workflowActionSchema = z.object({ type: z.literal("run_workflow"), steps: z.array(workflowStepSchema).min(2).max(20) }).strict();
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowAction = z.infer<typeof workflowActionSchema>;
export const preparedWorkflowSchema = workflowActionSchema.extend({
  preparedSteps: z.array(z.object({ step: key, action: z.unknown(), approvalMode: z.enum(["ask", "auto"]) }).strict()).max(20),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(28_000) }).strict()).max(15),
}).strict();
export type PreparedWorkflow = z.infer<typeof preparedWorkflowSchema>;

const direct = new Set(["create_company", "create_order", "create_invoice", "update_invoice", "send_invoice", "write_email", "update_company", "add_company_note", "create_flow"]);
export function workflowPolicyAction(step: Pick<WorkflowStep, "tool" | "input">) {
  if (step.tool === "run_workflow") throw new Error("Nested workflows are not supported.");
  return direct.has(step.tool) ? { ...step.input, type: step.tool } : { type: "crm_action", operation: { ...step.input, op: step.tool } };
}

/** Only real, documented identifiers can be passed between business actions. */
export const workflowResultIds: Record<string, readonly string[]> = {
  create_company: ["companyId"], update_company: ["companyId"], add_company_note: ["companyId"],
  create_order: ["orderId", "invoiceId"], create_invoice: ["orderId", "invoiceId"], update_invoice: ["invoiceId"], send_invoice: ["invoiceId"],
  save_order: ["orderId", "companyId"], invoice_order: ["invoiceId", "companyId"],
  create_quotation: ["quotationId"], update_quotation: ["quotationId"], quotation_lifecycle: ["quotationId", "orderId"],
  create_flow: ["flowId"], create_task: ["taskId"], update_task: ["taskId"],
  update_flow: ["flowId"], duplicate_flow: ["flowId"], flow_status: ["flowId"], create_segment: ["segmentId"], update_segment: ["segmentId"],
  conversation_auto_reply: ["automationId"], approve_auto_reply_shipping: ["automationId"], add_business_fact: ["factId"],
};
const destinations = new Set(["id", "companyId", "invoiceId", "orderId", "quotationId", "flowId", "taskId", "automationId", "factId", "segmentId"]);
export function validateWorkflowGraph(steps: WorkflowStep[]) {
  const previous = new Map<string, WorkflowStep>();
  for (const step of steps) {
    if (previous.has(step.id)) throw new Error(`Workflow step ${step.id} is repeated.`);
    for (const dependency of step.dependsOn) if (!previous.has(dependency)) throw new Error(`Step ${step.id} must depend on an earlier step, not ${dependency}.`);
    const bound = new Set<string>();
    for (const binding of step.bindings) {
      const source = previous.get(binding.step);
      if (!source) throw new Error(`Step ${step.id} must reference an earlier step, not ${binding.step}.`);
      if (!Object.hasOwn(workflowResultIds, source.tool) || !workflowResultIds[source.tool].includes(binding.result)) throw new Error(`${source.tool} does not return ${binding.result}. Use a supported result identifier.`);
      const last = binding.path.at(-1)!;
      const field = /^\d+$/.test(last) && binding.path.at(-2)?.endsWith("Ids") ? binding.path.at(-2)!.slice(0, -1) : last;
      if (!destinations.has(field) || (field !== "id" && field !== binding.result)) throw new Error(`Bind a matching record ID, not ${binding.path.join(".")}.`);
      const destination = binding.path.join(".");
      if (bound.has(destination)) throw new Error(`Step ${step.id} binds ${destination} more than once.`);
      bound.add(destination);
    }
    previous.set(step.id, step);
  }
}

export function resolveWorkflowInput(step: WorkflowStep, results: Record<string, Record<string, unknown>>, preview = false) {
  const input = structuredClone(step.input);
  for (const binding of step.bindings) {
    const value = preview ? "00000000-0000-4000-8000-000000000001" : results[binding.step]?.[binding.result];
    if (typeof value !== "string" || !value) throw new Error(`Step ${binding.step} did not confirm ${binding.result}; dependent work has not run.`);
    let target: Record<string, unknown> = input;
    for (const key of binding.path.slice(0, -1)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Invalid workflow binding path.");
      const next = target[key];
      if (!next || typeof next !== "object") throw new Error(`Supply the object containing ${binding.path.join(".")} before binding its ID.`);
      target = next as Record<string, unknown>;
    }
    target[binding.path.at(-1)!] = value;
  }
  return input;
}
