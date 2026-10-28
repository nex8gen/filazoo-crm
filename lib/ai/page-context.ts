import { z } from "zod";
import { flowInputSchema } from "../flows.ts";

export const assistantPageContextSchema = z.object({
  invoiceId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  emailId: z.string().min(1).max(512).optional(),
  mailboxId: z.uuid().optional(),
  conversationId: z.string().min(1).max(512).optional(),
  flowId: z.uuid().optional(),
  flowDraft: flowInputSchema.optional(),
  flowUnsaved: z.boolean().optional(),
  flowStepId: z.string().max(100).optional(),
}).strict();

/** Keep request context and conversation identity tied to the same visible record. */
export function readAssistantPageContext(main: ParentNode | null) {
  const value = (attribute: string) => main?.querySelector(`[${attribute}]`)?.getAttribute(attribute) || undefined;
  let flowDraft: unknown;
  const encoded = value("data-ai-flow-draft");
  if (encoded && encoded.length <= 60_000) {
    try { const parsed = flowInputSchema.safeParse(JSON.parse(encoded)); if (parsed.success) flowDraft = parsed.data; } catch { /* Incomplete editor data is not a saved definition. */ }
  }
  return assistantPageContextSchema.parse({
    emailId: value("data-ai-email-id"), mailboxId: value("data-ai-mailbox-id"),
    invoiceId: value("data-ai-invoice-id"), companyId: value("data-ai-company-id"),
    conversationId: value("data-ai-conversation-id"), flowId: value("data-ai-flow-id"),
    flowDraft, flowUnsaved: value("data-ai-flow-unsaved") === "true", flowStepId: value("data-ai-flow-step-id"),
  });
}

export function assistantRecordScope(context: z.infer<typeof assistantPageContextSchema>) {
  return [context.mailboxId, context.emailId, context.conversationId, context.flowId || (context.flowDraft || context.flowUnsaved ? "new-flow" : undefined), context.invoiceId, context.companyId].filter(Boolean).join(":");
}
