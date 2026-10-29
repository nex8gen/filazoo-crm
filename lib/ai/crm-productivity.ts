import { z } from "zod";

const text = (maximum: number) => z.string().trim().min(1).max(maximum);
export const exportSelectionSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all") }).strict(),
  z.object({ scope: z.literal("selected"), companyIds: z.array(z.uuid()).min(1).max(500).refine((ids) => new Set(ids).size === ids.length) }).strict(),
  z.object({ scope: z.literal("segment"), segmentId: z.uuid() }).strict(),
  z.object({ scope: z.literal("search"), query: text(100) }).strict(),
]);
export type ExportSelection = z.infer<typeof exportSelectionSchema>;
export const taskChangesSchema = z.object({
  title: text(200).optional(), notes: z.string().trim().max(4000).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(), dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  status: z.enum(["open", "done", "cancelled"]).optional(),
}).strict().refine((changes) => Object.keys(changes).length > 0, "Specify a task change.");

export const productivityOperationSchemas = [
  z.object({ op: z.literal("create_task"), title: text(200), notes: z.string().trim().max(4000).default(""), companyId: z.uuid().optional(), priority: z.enum(["low", "normal", "high"]).default("normal"), dueAt: z.iso.datetime({ offset: true }).nullable().default(null) }).strict(),
  z.object({ op: z.literal("update_task"), taskId: z.uuid(), changes: taskChangesSchema }).strict(),
  z.object({ op: z.literal("export_companies"), selection: exportSelectionSchema }).strict(),
  z.object({ op: z.literal("download_document"), kind: z.enum(["invoice", "catalog"]), id: z.uuid() }).strict(),
  z.object({ op: z.literal("conversation_auto_reply"), emailId: text(512), mailboxId: z.uuid().optional(), enabled: z.boolean() }).strict(),
  z.object({ op: z.literal("approve_auto_reply_shipping"), automationId: z.uuid(), shippingMinor: z.number().int().min(0).max(100_000_000) }).strict(),
  z.object({ op: z.literal("add_business_fact"), title: text(200), content: text(10000) }).strict(),
  z.object({ op: z.literal("delete_business_fact"), factId: z.uuid() }).strict(),
] as const;
export const productivityOperationSchema = z.discriminatedUnion("op", productivityOperationSchemas);
export type ProductivityOperation = z.infer<typeof productivityOperationSchema>;
const operationNames = new Set(productivityOperationSchemas.map((schema) => schema.shape.op.value));
export function isProductivityOperation(value: { op: string }): value is ProductivityOperation {
  return operationNames.has(value.op as ProductivityOperation["op"]);
}
