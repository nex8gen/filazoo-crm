import { z } from "zod";
import { aiPolicySchema } from "../ai-policy.ts";
import { taskWorkActionSchema } from "../task-workflows.ts";
import { shipmentSchema } from "../customer-portal.ts";

const policyPatch = aiPolicySchema.partial().extend({ features: aiPolicySchema.shape.features.partial().optional(), data: aiPolicySchema.shape.data.partial().optional(), actions: aiPolicySchema.shape.actions.extend({ tagging: aiPolicySchema.shape.actions.shape.tagging.removeDefault() }).partial().optional() }).strict().refine(value => Object.keys(value).length > 0, "Specify an AI setting to change.");
export const featureOperationSchemas = [
  z.object({ op: z.literal("update_ai_settings"), changes: policyPatch }).strict(),
  z.object({ op: z.literal("update_email_footer"), html: z.string().max(30000) }).strict(),
  z.object({ op: z.literal("cancel_scheduled_email"), emailId: z.string().trim().min(1).max(512) }).strict(),
  z.object({ op: z.literal("discard_email_draft"), draftId: z.string().trim().min(1).max(512), mailboxId: z.uuid() }).strict(),
  z.object({ op: z.literal("task_workflow_action"), taskId: z.uuid(), input: taskWorkActionSchema }).strict(),
  z.object({ op: z.literal("portal_reply"), invoiceId: z.uuid(), body: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ op: z.literal("update_shipment"), invoiceId: z.uuid(), shipment: shipmentSchema }).strict(),
] as const;
export type FeatureOperation = z.infer<(typeof featureOperationSchemas)[number]>;
export function isFeatureOperation(operation: { op: string }): operation is FeatureOperation { return featureOperationSchemas.some(schema => schema.shape.op.value === operation.op); }
