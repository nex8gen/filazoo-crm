import { z } from "zod";
import { flowInputSchema } from "../flows.ts";
import { flowAnalyticsContextSchema } from "./flow-analytics-context.ts";

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
  flowAnalytics: flowAnalyticsContextSchema.optional(),
}).strict();

/** Keep request context and conversation identity tied to the same visible record. */
export function readAssistantPageContext(main: ParentNode | null) {
  // Next.js Activity and kept-mounted tabs retain hidden records in the DOM.
  // Only the visible record may determine a request's context and saved history.
  const value = (attribute: string) => Array.from(main?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? [])
    .find((element) => element.checkVisibility({ checkVisibilityCSS: true }))?.getAttribute(attribute) || undefined;
  let flowDraft: unknown;
  let flowAnalytics: z.infer<typeof flowAnalyticsContextSchema> | undefined;
  const analytics = value("data-ai-flow-analytics");
  if (analytics && analytics.length <= 2000) {
    try { const parsed = flowAnalyticsContextSchema.safeParse(JSON.parse(analytics)); if (parsed.success) flowAnalytics = parsed.data; } catch { /* Invalid filters do not become analytics evidence. */ }
  }
  const encoded = value("data-ai-flow-draft");
  if (encoded && encoded.length <= 60_000) {
    try { const parsed = flowInputSchema.safeParse(JSON.parse(encoded)); if (parsed.success) flowDraft = parsed.data; } catch { /* Incomplete editor data is not a saved definition. */ }
  }
  return assistantPageContextSchema.parse({
    emailId: value("data-ai-email-id"), mailboxId: value("data-ai-mailbox-id"),
    invoiceId: value("data-ai-invoice-id"), companyId: value("data-ai-company-id"),
    conversationId: value("data-ai-conversation-id"), flowId: value("data-ai-flow-id"),
    flowDraft, flowUnsaved: value("data-ai-flow-unsaved") === "true", flowStepId: value("data-ai-flow-step-id"), flowAnalytics,
  });
}

export function assistantRecordScope(context: z.infer<typeof assistantPageContextSchema>) {
  return [context.mailboxId, context.emailId, context.conversationId, context.flowId || (context.flowDraft || context.flowUnsaved ? "new-flow" : undefined), context.invoiceId, context.companyId, context.flowAnalytics ? `workflow-analytics:${JSON.stringify(context.flowAnalytics)}` : undefined].filter(Boolean).join(":");
}
