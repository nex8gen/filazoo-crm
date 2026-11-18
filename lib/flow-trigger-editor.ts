import { emailCategories, flowInputSchema, flowLeadLists, type FlowInput, type JsonConfig, type TriggerType } from "./flows.ts";
import { isSegmentAudienceFlow } from "./segment-flows.ts";

export const editableTriggerTypes = ["new_lead", "email_received", "category_changed", "no_reply", "lead_added_to_list", "company_segment_changed", "dormant_customer"] as const;
const eventFields = ["category", "amount", "unit", "businessDays", "receivingMailboxId", "listId", "stage", "inactivityMonths"];

export function triggerEventDraft(flow: Pick<FlowInput, "triggerType" | "triggerConfig">, type: TriggerType, segments: string[] = []): JsonConfig {
  const config = { ...flow.triggerConfig };
  for (const key of eventFields) delete config[key];
  if (type === "category_changed") config.category = flow.triggerConfig.category || emailCategories[0];
  if (type === "dormant_customer") config.inactivityMonths = flow.triggerConfig.inactivityMonths || 1;
  if (type === "no_reply") Object.assign(config, { amount: flow.triggerConfig.amount ?? 2, unit: flow.triggerConfig.unit || "days", businessDays: flow.triggerConfig.businessDays ?? true });
  if (type === "lead_added_to_list") config.listId = flow.triggerConfig.listId || flowLeadLists[0];
  if (type === "company_segment_changed") config.segment = flow.triggerConfig.segment || segments[0] || "";
  if (type === "email_received" && flow.triggerConfig.receivingMailboxId) config.receivingMailboxId = flow.triggerConfig.receivingMailboxId;
  return config;
}

/** Event changes cannot replace the workflow's audience or re-entry policy. */
export function applyTriggerEvent(flow: Pick<FlowInput, "triggerType" | "triggerConfig">, type: TriggerType, candidate: JsonConfig) {
  if (isSegmentAudienceFlow(flow.triggerType, flow.triggerConfig)) return { triggerType: flow.triggerType, triggerConfig: { ...flow.triggerConfig } };
  const config = { ...flow.triggerConfig };
  for (const key of eventFields) delete config[key];
  const fields = type === "dormant_customer" ? ["inactivityMonths"] : type === "category_changed" ? ["category"] : type === "no_reply" ? ["amount", "unit", "businessDays"] : type === "lead_added_to_list" ? ["listId"] : type === "company_segment_changed" ? ["segment"] : type === "email_received" ? ["receivingMailboxId"] : [];
  for (const key of fields) if (key in candidate) config[key] = candidate[key];
  return { triggerType: type, triggerConfig: config };
}

export function triggerProfileFields(flow: Pick<FlowInput, "triggerType" | "triggerConfig">) {
  return ["country", "companyStatus", "minFitScore", ...(flow.triggerType !== "company_segment_changed" ? ["segment"] : []), ...(!flow.triggerConfig.flowScope && !isSegmentAudienceFlow(flow.triggerType, flow.triggerConfig) ? ["contactIds"] : [])];
}

/** Only runtime-supported filter fields can be applied; locked scope stays intact. */
export function applyTriggerProfiles(flow: Pick<FlowInput, "triggerType" | "triggerConfig">, candidate: JsonConfig): JsonConfig {
  const config = { ...flow.triggerConfig };
  for (const key of triggerProfileFields(flow)) {
    delete config[key];
    if (key in candidate) config[key] = candidate[key];
  }
  return config;
}

export function triggerProfileSummary(flow: Pick<FlowInput, "triggerType" | "triggerConfig">): string[] {
  const config = flow.triggerConfig;
  const result: string[] = [];
  if (flow.triggerType !== "company_segment_changed" && config.segment) result.push(`Company segment is ${config.segment}`);
  if (config.country) result.push(`Country is ${config.country}`);
  if (config.companyStatus) result.push(`Company status is ${String(config.companyStatus).replaceAll("_", " ")}`);
  if (typeof config.minFitScore === "number") result.push(`Fit score is at least ${config.minFitScore}`);
  if (!config.flowScope && !isSegmentAudienceFlow(flow.triggerType, config) && "contactIds" in config) {
    const count = Array.isArray(config.contactIds) ? config.contactIds.length : 0;
    result.push(count ? `${count} selected customer${count === 1 ? "" : "s"} only` : "No customers selected");
  }
  return result;
}

export function triggerSettingsError(type: TriggerType, config: JsonConfig): string | null {
  // Validate with the same schema as saving, independently of unfinished actions.
  const result = flowInputSchema.safeParse({ name: "Trigger settings", status: "draft", triggerType: type, triggerConfig: config, steps: [{ id: "trigger-validation", type: "stop", config: { reason: "", outcome: "completed" } }] });
  return result.success ? null : result.error.issues[0]?.message || "Complete the trigger settings.";
}
