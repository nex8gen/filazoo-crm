import { z } from "zod";

export const flowStatuses = ["draft", "live", "paused"] as const;
export const triggerTypes = ["email_received", "category_changed", "no_reply", "lead_added_to_list", "company_segment_changed", "pipeline_stage_changed"] as const;
export const stepTypes = ["wait", "if_condition", "send_email", "create_task", "change_category", "internal_alert", "stop"] as const;
export const emailCategories = ["Needs follow-up", "Waiting on customer", "Interested", "Big order", "No action"] as const;
export const companyStatuses = ["new", "researching", "qualified", "contacted", "engaged", "customer", "disqualified"] as const;
export const pipelineStages = ["new", "contacted", "replied", "interested", "big_order", "won", "lost"] as const;

export type FlowStatus = (typeof flowStatuses)[number];
export type TriggerType = (typeof triggerTypes)[number];
export type FlowStepType = (typeof stepTypes)[number];
export type JsonConfig = Record<string, string | number | boolean | null>;

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
  email_received: "Email received",
  category_changed: "Category changed to",
  no_reply: "No reply after",
  lead_added_to_list: "Lead added to list",
  company_segment_changed: "Company enters segment",
  pipeline_stage_changed: "Pipeline stage changed",
};

export const stepLabels: Record<FlowStepType, string> = {
  wait: "Wait",
  if_condition: "If condition",
  send_email: "Send email",
  create_task: "Create CRM task",
  change_category: "Change category",
  internal_alert: "Internal alert",
  stop: "Stop",
};

const configValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const configSchema = z.record(z.string(), configValue);

const profileFilters = {
  segment: z.string().trim().max(120).optional(),
  country: z.string().trim().max(100).optional(),
  companyStatus: z.enum(companyStatuses).optional(),
  pipelineStage: z.enum(pipelineStages).optional(),
  minFitScore: z.number().int().min(1).max(10).optional(),
};

const triggerConfigSchemas: Record<TriggerType, z.ZodType<JsonConfig>> = {
  email_received: z.object({ ...profileFilters }),
  category_changed: z.object({ category: z.enum(emailCategories), ...profileFilters }),
  no_reply: z.object({ amount: z.number().int().min(1).max(365), unit: z.enum(["hours", "days"]), businessDays: z.boolean().optional(), ...profileFilters }),
  lead_added_to_list: z.object({ listId: z.string().trim().min(1).max(160), ...profileFilters }),
  company_segment_changed: z.object({ segment: z.string().trim().min(1).max(120), country: profileFilters.country, companyStatus: profileFilters.companyStatus, pipelineStage: profileFilters.pipelineStage, minFitScore: profileFilters.minFitScore }),
  pipeline_stage_changed: z.object({ stage: z.enum(pipelineStages), ...profileFilters }),
};

const stepConfigSchemas: Record<FlowStepType, z.ZodType<JsonConfig>> = {
  wait: z.object({
    amount: z.number().int().min(1).max(525600),
    unit: z.enum(["minutes", "hours", "days"]),
    businessDays: z.boolean().optional(),
    resumeAt: z.string().trim().max(20).optional(),
  }),
  if_condition: z.object({
    field: z.enum(["customer_replied", "category_is", "opened_email", "clicked_link"]),
    category: z.enum(emailCategories).optional(),
    action: z.enum(["stop_flow", "continue", "skip_next"]),
    unmatchedAction: z.enum(["stop_flow", "continue", "skip_next"]).optional(),
    lookbackDays: z.number().int().min(1).max(365).optional(),
  }).superRefine((value, context) => {
    if (value.field === "category_is" && !value.category) context.addIssue({ code: "custom", path: ["category"], message: "Choose a category." });
  }),
  send_email: z.object({
    templateId: z.string().trim().min(1),
    mailboxId: z.string().trim().min(1),
    replyInThread: z.boolean(),
    subject: z.string().trim().max(300).optional(),
    preheader: z.string().trim().max(300).optional(),
    trackOpens: z.boolean().optional(),
    trackClicks: z.boolean().optional(),
    utmTracking: z.boolean().optional(),
    stopOnReply: z.boolean().optional(),
    sendWindow: z.enum(["anytime", "business_hours"]).optional(),
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
  internal_alert: z.object({ userId: z.string().trim().min(1), message: z.string().trim().min(1).max(500), includeThreadLink: z.boolean().optional(), channel: z.enum(["in_app", "email"]).optional() }),
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
  })).min(1, "Add at least one step.").max(50),
}).superRefine((flow, context) => {
  const trigger = triggerConfigSchemas[flow.triggerType].safeParse(flow.triggerConfig);
  if (!trigger.success) context.addIssue({ code: "custom", path: ["triggerConfig"], message: "Complete the trigger settings." });
  flow.steps.forEach((step, index) => {
    const result = stepConfigSchemas[step.type].safeParse(step.config);
    if (!result.success) context.addIssue({ code: "custom", path: ["steps", index, "config"], message: result.error.issues[0]?.message || "Complete this step." });
  });
});

export type FlowInput = z.infer<typeof flowInputSchema>;

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
    wait: { amount: 1, unit: "days", businessDays: true, resumeAt: "09:00" },
    if_condition: { field: "customer_replied", action: "stop_flow", unmatchedAction: "continue", lookbackDays: 7 },
    send_email: { templateId: "", mailboxId: "default", replyInThread: true, subject: "", preheader: "", trackOpens: true, trackClicks: true, utmTracking: true, stopOnReply: true, sendWindow: "business_hours" },
    create_task: { assigneeType: "owner", assigneeId: null, dueInDays: 1, title: "Follow up with customer", priority: "normal", notes: "" },
    change_category: { category: "Needs follow-up", reason: "" },
    internal_alert: { userId: "owner", message: "This conversation needs attention.", includeThreadLink: true, channel: "in_app" },
    stop: { reason: "Automation completed", outcome: "completed" },
  };
  return { id, type, config: configs[type] };
}

export function formatTrigger(type: TriggerType, config: JsonConfig) {
  if (type === "category_changed") return `Category changed to ${config.category || "…"}`;
  if (type === "no_reply") return `No reply after ${config.amount || "…"} ${config.unit || "days"}`;
  if (type === "lead_added_to_list") return `Lead added to ${config.listId || "list"}`;
  if (type === "company_segment_changed") return `Company enters ${config.segment || "a segment"}`;
  if (type === "pipeline_stage_changed") return `Pipeline stage changed to ${String(config.stage || "stage").replaceAll("_", " ")}`;
  return triggerLabels[type];
}
