import { z } from "zod";
import { hasRetiredSalesConfig, retiredSalesMessage } from "./retired-sales.ts";
export { hasRetiredSalesConfig, retiredSalesMessage } from "./retired-sales.ts";

export const flowStatuses = ["draft", "live", "paused"] as const;
export const triggerTypes = ["new_lead", "email_received", "category_changed", "no_reply", "lead_added_to_list", "company_segment_changed", "pipeline_stage_changed"] as const;
export const stepTypes = ["wait", "split", "if_condition", "send_email", "ai_auto_reply", "create_task", "change_category", "update_company", "internal_alert", "stop"] as const;
export const emailCategories = ["Needs follow-up", "Waiting on customer", "Interested", "Big order", "No action"] as const;
export const companyStatuses = ["new", "researching", "qualified", "contacted", "engaged", "customer", "disqualified"] as const;
export const pipelineStages = ["new", "contacted", "replied", "interested", "big_order", "won", "lost"] as const;
export const flowLeadLists = ["Shopify B2B leads", "Meta ad leads"] as const;
export function flowLeadListForSource(source: string | null | undefined) {
  if (source === "shopify_b2b_form" || source === "shopify_b2b_form_opt_in") return "Shopify B2B leads";
  return source === "meta_lead_ads" ? "Meta ad leads" : null;
}

export type FlowStatus = (typeof flowStatuses)[number];
export const flowBulkInputSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(100).transform((ids) => [...new Set(ids)]),
  action: z.enum(["live", "paused", "delete"]),
});
export type FlowBulkAction = z.infer<typeof flowBulkInputSchema>["action"];
export type FlowBulkResult = { id: string; ok: true; flow?: AutomationFlow } | { id: string; ok: false; error: string };
export type TriggerType = (typeof triggerTypes)[number];
export type FlowStepType = (typeof stepTypes)[number];
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonConfig = Record<string, JsonValue>;

export type FlowStep = {
  id: string;
  position: number;
  type: FlowStepType;
  config: JsonConfig;
};

export type AutomationFlow = {
  id: string;
  name: string;
  triggerType: TriggerType;
  triggerConfig: JsonConfig;
  status: FlowStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  activeRuns: number;
  completedRuns: number;
  steps: FlowStep[];
};

export const triggerLabels: Record<TriggerType, string> = {
  new_lead: "New lead",
  email_received: "Email received",
  category_changed: "Category changed to",
  no_reply: "No reply after",
  lead_added_to_list: "Lead added to list",
  company_segment_changed: "Company enters segment",
  pipeline_stage_changed: "Retired sales trigger",
};

export const stepLabels: Record<FlowStepType, string> = {
  ai_auto_reply: "AI auto-reply",
  wait: "Wait",
  split: "Split",
  if_condition: "If condition",
  send_email: "Send email",
  create_task: "Create CRM task",
  change_category: "Change category",
  update_company: "Property update",
  internal_alert: "Internal alert",
  stop: "Stop",
};

const configValue: z.ZodType<JsonValue> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(configValue), z.record(z.string(), configValue)]));
const configSchema: z.ZodType<JsonConfig> = z.record(z.string(), configValue);

const profileFilters = {
  flowScope: z.enum(["email", "company"]).optional(),
  scopeCompanyId: z.uuid().optional(),
  scopeContactId: z.uuid().optional(),
  scopeLabel: z.string().trim().min(1).max(320).optional(),
  contactIds: z.array(z.uuid().transform((id) => id.toLowerCase())).min(1, "Choose at least one customer or select all customers.").max(200).transform((ids) => [...new Set(ids)]).optional(),
  segment: z.string().trim().max(120).optional(),
  country: z.string().trim().max(100).optional(),
  companyStatus: z.enum(companyStatuses).optional(),
  pipelineStage: z.enum(pipelineStages).optional(),
  minFitScore: z.number().int().min(1).max(10).optional(),
  reentryMode: z.enum(["no_reentry", "every_event", "after_period"]).optional(),
  reentryAfterAmount: z.number().int().min(1).max(3650).optional(),
  reentryAfterUnit: z.enum(["hours", "days"]).optional(),
};

const triggerConfigSchemas: Record<TriggerType, z.ZodType<JsonConfig>> = {
  new_lead: z.object({ ...profileFilters }),
  email_received: z.object({ ...profileFilters }),
  category_changed: z.object({ category: z.enum(emailCategories), ...profileFilters }),
  no_reply: z.object({ amount: z.number().int().min(1).max(365), unit: z.enum(["hours", "days"]), businessDays: z.boolean().optional(), ...profileFilters }),
  lead_added_to_list: z.object({ listId: z.enum(flowLeadLists), ...profileFilters }),
  company_segment_changed: z.object({ ...profileFilters, segment: z.string().trim().min(1).max(120) }),
  pipeline_stage_changed: z.object({ stage: z.enum(pipelineStages), ...profileFilters }),
};

export const conditionOperators = ["equals", "not_equals", "contains", "not_contains", "starts_with", "ends_with", "is_set", "is_not_set", "gte", "gt", "lte", "lt"] as const;
export const flowConditionRuleSchema = z.object({
  field: z.enum(["customer_replied", "category_is", "opened_email", "clicked_link", "company_status_is", "pipeline_stage_is", "segment_is", "country_is", "fit_score_at_least"]),
  category: z.enum(emailCategories).optional(),
  companyStatus: z.enum(companyStatuses).optional(),
  pipelineStage: z.enum(pipelineStages).optional(),
  value: z.string().trim().max(120).optional(),
  fitScore: z.number().int().min(0).max(10).optional(),
  operator: z.enum(conditionOperators).optional(),
  negate: z.boolean().optional(),
  lookbackDays: z.number().int().min(1).max(365).optional(),
}).superRefine((value, context) => {
  if (["is_set", "is_not_set"].includes(value.operator || "")) return;
  const required = value.field === "category_is" ? value.category : value.field === "company_status_is" ? value.companyStatus : value.field === "pipeline_stage_is" ? value.pipelineStage : ["segment_is", "country_is"].includes(value.field) ? value.value : value.field === "fit_score_at_least" ? value.fitScore : true;
  if (required === undefined || required === "") context.addIssue({ code: "custom", message: "Complete the path comparison value." });
  if (["gte", "gt", "lte", "lt"].includes(value.operator || "") && value.field !== "fit_score_at_least") context.addIssue({ code: "custom", message: "Numeric comparisons require a fit-score condition." });
});
export const flowConditionCriteriaSchema = z.union([
  flowConditionRuleSchema,
  z.object({ match: z.enum(["all", "any"]), rules: z.array(flowConditionRuleSchema).min(1).max(20) }),
]);

const stepConfigSchemas: Record<FlowStepType, z.ZodType<JsonConfig>> = {
  ai_auto_reply: z.object({
    filters: flowConditionCriteriaSchema.optional(),
    smartSendingHours: z.number().int().min(0).max(720).optional(),
    mailboxId: z.string().trim().min(1),
    replyInThread: z.boolean(),
    useProducts: z.boolean(),
    usePrices: z.boolean(),
    attachCatalog: z.boolean(),
    catalogFirstMessageOnly: z.boolean(),
    instructions: z.string().trim().max(4000),
    language: z.enum(["auto", "en", "zh-CN"]).transform(() => "en"),
    sendWindow: z.enum(["anytime", "business_hours"]),
    trackOpens: z.boolean().optional(),
    trackClicks: z.boolean().optional(),
    utmTracking: z.boolean().optional(),
  }).superRefine((value, context) => {
    if (value.usePrices && !value.useProducts) context.addIssue({ code: "custom", message: "Enable product information before using prices." });
  }),
  wait: z.object({
    amount: z.number().int().min(1).max(525600),
    unit: z.enum(["minutes", "hours", "days"]),
    businessDays: z.boolean().optional(),
    resumeAt: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a valid resume time.")]).optional(),
  }),
  split: z.object({
    name: z.string().trim().min(1).max(120),
    paths: z.array(z.object({
      id: z.string().trim().min(1).max(100),
      name: z.string().trim().min(1).max(120),
      condition: configSchema.nullable(),
      steps: z.array(z.object({ id: z.string().trim().min(1).max(100), type: z.enum(stepTypes), config: configSchema })).max(25),
    })).min(2).max(20),
  }).superRefine((value, context) => {
    const defaults = value.paths.filter((path) => path.condition === null);
    if (defaults.length !== 1 || value.paths.at(-1)?.condition !== null) context.addIssue({ code: "custom", path: ["paths"], message: "A split needs one final Everyone else path." });
    value.paths.forEach((path, pathIndex) => {
      if (path.condition) {
        const result = flowConditionCriteriaSchema.safeParse(path.condition);
        if (!result.success) context.addIssue({ code: "custom", path: ["paths", pathIndex, "condition"], message: result.error.issues[0]?.message || "Complete the path criteria." });
      }
      path.steps.forEach((step, stepIndex) => {
        const result = stepConfigSchemas[step.type].safeParse(step.config);
        if (!result.success) context.addIssue({ code: "custom", path: ["paths", pathIndex, "steps", stepIndex], message: result.error.issues[0]?.message || "Complete the path action." });
      });
    });
  }).transform((value) => ({ ...value, paths: value.paths.map((path) => ({ ...path, steps: path.steps.map((step) => ({ ...step, config: stepConfigSchemas[step.type].parse(step.config) })) })) })),
  if_condition: z.object({
    field: z.enum(["customer_replied", "category_is", "opened_email", "clicked_link", "company_status_is", "pipeline_stage_is", "segment_is", "country_is", "fit_score_at_least"]),
    category: z.enum(emailCategories).optional(),
    companyStatus: z.enum(companyStatuses).optional(),
    pipelineStage: z.enum(pipelineStages).optional(),
    value: z.string().trim().max(120).optional(),
    fitScore: z.number().int().min(1).max(10).optional(),
    action: z.enum(["stop_flow", "continue", "skip_next"]),
    unmatchedAction: z.enum(["stop_flow", "continue", "skip_next"]).optional(),
    lookbackDays: z.number().int().min(1).max(365).optional(),
  }).superRefine((value, context) => {
    if (value.field === "category_is" && !value.category) context.addIssue({ code: "custom", path: ["category"], message: "Choose a category." });
    if (value.field === "company_status_is" && !value.companyStatus) context.addIssue({ code: "custom", path: ["companyStatus"], message: "Choose a company status." });
    if (value.field === "pipeline_stage_is" && !value.pipelineStage) context.addIssue({ code: "custom", path: ["pipelineStage"], message: "Choose a pipeline stage." });
    if (["segment_is", "country_is"].includes(value.field) && !value.value) context.addIssue({ code: "custom", path: ["value"], message: "Enter a value to match." });
    if (value.field === "fit_score_at_least" && !value.fitScore) context.addIssue({ code: "custom", path: ["fitScore"], message: "Choose a fit score." });
  }),
  send_email: z.object({
    filters: flowConditionCriteriaSchema.optional(),
    smartSendingHours: z.number().int().min(0).max(720).optional(),
    templateId: z.enum(["helpful_reminder", "send_catalog", "quote_follow_up", "welcome_intro", "last_chance"], { error: "Complete the email template settings." }),
    mailboxId: z.string().trim().min(1),
    replyInThread: z.boolean(),
    subject: z.string().trim().max(300).optional(),
    body: z.string().trim().min(1).max(20000).optional(),
    preheader: z.string().trim().max(300).optional(),
    trackOpens: z.boolean().optional(),
    trackClicks: z.boolean().optional(),
    utmTracking: z.boolean().optional(),
    stopOnReply: z.boolean().optional(),
    sendWindow: z.enum(["anytime", "business_hours"]).default("business_hours"),
  }),
  create_task: z.object({
    assigneeType: z.enum(["owner", "user"]),
    assigneeId: z.string().trim().nullable().optional(),
    dueInDays: z.number().int().min(0).max(365),
    title: z.string().trim().min(1).max(200),
    priority: z.enum(["low", "normal", "high"]).optional(),
    notes: z.string().trim().max(1000).optional(),
  }).superRefine((value, context) => {
    if (value.assigneeType === "user" && !value.assigneeId) context.addIssue({ code: "custom", path: ["assigneeId"], message: "Choose a user." });
  }),
  change_category: z.object({ category: z.enum(emailCategories), reason: z.string().trim().max(300).optional() }),
  update_company: z.object({
    companyStatus: z.enum(companyStatuses).optional(),
    pipelineStage: z.enum(pipelineStages).optional(),
    segment: z.string().trim().min(1).max(120).optional(),
    note: z.string().trim().max(500).optional(),
  }).refine((value) => Boolean(value.companyStatus || value.pipelineStage || value.segment), "Choose at least one company field to update."),
  internal_alert: z.object({ userId: z.string().trim().min(1), message: z.string().trim().min(1).max(500), includeThreadLink: z.boolean().optional(), channel: z.enum(["in_app", "email"]).optional(), mailboxId: z.string().trim().min(1).optional() }),
  stop: z.object({ reason: z.string().trim().max(300).optional(), outcome: z.enum(["completed", "cancelled"]).optional() }),
};

export const flowInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a flow name.").max(160),
  triggerType: z.enum(triggerTypes),
  triggerConfig: configSchema,
  status: z.enum(flowStatuses),
  steps: z.array(z.object({
    id: z.string().trim().min(1).max(100).optional(),
    type: z.enum(stepTypes),
    config: configSchema,
  })).min(1, "Add at least one step.").max(500),
}).superRefine((flow, context) => {
  if (hasRetiredSalesConfig(flow)) {
    context.addIssue({ code: "custom", message: retiredSalesMessage });
    return;
  }
  let totalActions = 0;
  let treeError = "";
  const identities = new Set<string>();
  function inspect(steps: Array<{ id?: string; type: string; config: JsonConfig }>, depth = 0) {
    for (const step of steps) {
      if (!step || typeof step !== "object" || !step.config || typeof step.config !== "object") continue;
      if (++totalActions > 500) { treeError = "A flow can contain up to 500 actions across its paths."; return; }
      if (step.id) {
        if (identities.has(step.id)) treeError = "Every action and path needs a unique ID. Duplicate the action to create an independent copy.";
        identities.add(step.id);
      }
      if (step.type !== "split") continue;
      if (depth >= 5) { treeError = "A flow supports up to five levels of splits."; return; }
      for (const path of Array.isArray(step.config.paths) ? step.config.paths : []) {
        if (!path || typeof path !== "object" || Array.isArray(path)) continue;
        if (typeof path.id === "string") {
          if (identities.has(path.id)) treeError = "Every action and path needs a unique ID.";
          identities.add(path.id);
        }
        if (Array.isArray(path.steps)) inspect(path.steps as unknown as typeof steps, depth + 1);
        if (treeError) return;
      }
    }
  }
  inspect(flow.steps);
  if (treeError) { context.addIssue({ code: "custom", path: ["steps"], message: treeError }); return; }
  const scope = flow.triggerConfig;
  if (scope.flowScope && (!scope.scopeCompanyId || (scope.flowScope === "email" && !scope.scopeContactId))) {
    context.addIssue({ code: "custom", path: ["triggerConfig"], message: "Choose the email or company for this flow." });
  }
  if (!scope.flowScope && (scope.scopeCompanyId || scope.scopeContactId || scope.scopeLabel)) {
    context.addIssue({ code: "custom", path: ["triggerConfig"], message: "A scoped flow must retain its email or company scope." });
  }
  if (scope.flowScope === "company" && scope.scopeContactId) {
    context.addIssue({ code: "custom", path: ["triggerConfig"], message: "Company flows cannot specify an individual email scope." });
  }
  if (scope.reentryMode === "after_period" && (!scope.reentryAfterAmount || !scope.reentryAfterUnit)) {
    context.addIssue({ code: "custom", path: ["triggerConfig"], message: "Choose the re-entry waiting period." });
  }
  const trigger = triggerConfigSchemas[flow.triggerType].safeParse(flow.triggerConfig);
  if (!trigger.success) context.addIssue({ code: "custom", path: ["triggerConfig"], message: trigger.error.issues[0]?.message || "Complete the trigger settings." });
  flow.steps.forEach((step, index) => {
    const result = stepConfigSchemas[step.type].safeParse(step.config);
    if (!result.success) context.addIssue({ code: "custom", path: ["steps", index, "config"], message: result.error.issues[0]?.message || "Complete this step." });
  });
}).transform((flow) => ({
  ...flow,
  triggerConfig: triggerConfigSchemas[flow.triggerType].parse(flow.triggerConfig),
  steps: flow.steps.map((step) => ({ ...step, config: stepConfigSchemas[step.type].parse(step.config) })),
}));

export type FlowInput = z.infer<typeof flowInputSchema>;

export function isEmailScopedFlow(config: JsonConfig) {
  return Boolean(config.flowScope || config.scopeCompanyId || config.scopeContactId);
}

export function emailFlowScope(config: JsonConfig): JsonConfig {
  return Object.fromEntries(["flowScope", "scopeCompanyId", "scopeContactId", "scopeLabel"].filter((key) => key in config).map((key) => [key, config[key]]));
}

export const defaultFlowInput: FlowInput = {
  name: "3-step follow-up",
  triggerType: "no_reply",
  triggerConfig: { amount: 2, unit: "days", businessDays: true },
  status: "draft",
  steps: [
    { id: "wait-2d", type: "wait", config: { amount: 2, unit: "days", businessDays: true, resumeAt: "09:00" } },
    { id: "send-reminder", type: "send_email", config: { templateId: "helpful_reminder", mailboxId: "default", replyInThread: true, subject: "Just checking in", preheader: "A quick follow-up from Filazoo", trackOpens: true, trackClicks: true, utmTracking: true, stopOnReply: true, sendWindow: "business_hours" } },
    { id: "create-task", type: "create_task", config: { assigneeType: "owner", assigneeId: null, dueInDays: 0, title: "Follow up with customer", priority: "high", notes: "Review the thread and call if the customer has not replied." } },
  ],
};

export function blankStep(type: FlowStepType = "wait"): FlowInput["steps"][number] {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `step-${Date.now()}`;
  const configs: Record<FlowStepType, JsonConfig> = {
    ai_auto_reply: { mailboxId: "default", replyInThread: true, useProducts: true, usePrices: true, attachCatalog: true, catalogFirstMessageOnly: true, instructions: "", language: "en", sendWindow: "anytime", trackOpens: true, trackClicks: true },
    wait: { amount: 1, unit: "days", businessDays: true, resumeAt: "09:00" },
    split: { name: "Customer path", paths: [{ id: `${id}-match`, name: "Path 1", condition: { field: "customer_replied", lookbackDays: 7 }, steps: [] }, { id: `${id}-otherwise`, name: "Everyone else", condition: null, steps: [] }] },
    if_condition: { field: "customer_replied", action: "stop_flow", unmatchedAction: "continue", lookbackDays: 7 },
    send_email: { templateId: "", mailboxId: "default", replyInThread: true, subject: "", preheader: "", trackOpens: true, trackClicks: true, utmTracking: true, stopOnReply: true, sendWindow: "business_hours" },
    create_task: { assigneeType: "owner", assigneeId: null, dueInDays: 1, title: "Follow up with customer", priority: "normal", notes: "" },
    change_category: { category: "Needs follow-up", reason: "" },
    update_company: { companyStatus: "engaged", note: "Updated by automation" },
    internal_alert: { userId: "owner", message: "This conversation needs attention.", includeThreadLink: true, channel: "in_app" },
    stop: { reason: "Automation completed", outcome: "completed" },
  };
  return { id, type, config: configs[type] };
}

/** Copies must have independent canvas/tracking identities, including actions inside split paths. */
export function cloneFlowStep(step: FlowInput["steps"][number]): FlowInput["steps"][number] {
  const copy = { ...step, id: blankStep(step.type).id, config: structuredClone(step.config) };
  if (copy.type === "split" && Array.isArray(copy.config.paths)) {
    copy.config.paths = copy.config.paths.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.steps)) return value;
      return { ...value, id: blankStep("wait").id!, steps: (value.steps as FlowInput["steps"]).map(cloneFlowStep) as unknown as JsonValue[] };
    });
  }
  return copy;
}

/** Keep the assistant's configuration guide tied to the same validators as the flow editor. */
export function flowAgentCapabilities() {
  function currentSchema(value: unknown): unknown {
    if (Array.isArray(value)) return value.filter(item => item !== "pipeline_stage_is" && item !== "pipeline_stage_changed").map(currentSchema);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "pipelineStage").map(([key, field]) => [key, currentSchema(field)]));
  }
  return {
    triggerConfigs: Object.fromEntries(triggerTypes.filter(type => type !== "pipeline_stage_changed").map((type) => [type, currentSchema(z.toJSONSchema(triggerConfigSchemas[type], { io: "input" }))])),
    stepConfigs: Object.fromEntries(stepTypes.map((type) => [type, currentSchema(z.toJSONSchema(stepConfigSchemas[type], { io: "input" }))])),
    stepDefaults: Object.fromEntries(stepTypes.map((type) => [type, { ...blankStep(type).config, ...(type === "send_email" ? { templateId: "helpful_reminder" } : {}) }])),
    emailTemplates: ["helpful_reminder", "send_catalog", "quote_follow_up", "welcome_intro", "last_chance"],
    timezone: "UTC",
  };
}

export function formatTrigger(type: TriggerType, config: JsonConfig) {
  if (type === "category_changed") return `Category changed to ${config.category || "…"}`;
  if (type === "no_reply") return `No reply after ${config.amount || "…"} ${config.unit || "days"}`;
  if (type === "lead_added_to_list") return `Lead added to ${config.listId || "list"}`;
  if (type === "company_segment_changed") return `Company enters ${config.segment || "a segment"}`;
  if (type === "pipeline_stage_changed") return "Retired sales trigger";
  return triggerLabels[type];
}
