import { z } from "zod";
import { companyChatInstruction } from "../lib/ai/company-chat.ts";
import { buildEmailReplyInstruction, parseEmailReplyPlan } from "../lib/ai/email-reply.ts";
import { buildEmailRewriteInstruction, buildEmailRewritePrompt } from "../lib/ai/email-rewrite.ts";
import { buildEmailSummaryInstruction, parseEmailSummary } from "../lib/ai/email-summary.ts";
import { flowReplyInstruction, resolveFlowReply, flowCatalogInstruction, resolveFlowCatalog } from "../lib/ai/flow-reply.ts";
import { conversationTagInstruction, conversationTagDecisionSchema, parseConversationTagDecision } from "../lib/ai/conversation-tagging.ts";
import { customerTags } from "../lib/customer-tags.ts";
import { replyWorkInstruction, replyWorkPlanSchema, groundedReplyChanges } from "../lib/task-workflows.ts";
import { syntheticServerData, type EvaluationCase } from "./agent-evaluation-cases.ts";

const parse = (output: string) => JSON.parse(output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
export function aiTextEvaluationCases(): EvaluationCase[] {
  const data = syntheticServerData();
  const messages = [{ direction: "inbound", body: "Please prepare a draft invoice for 500 Black PLA Basic spools. Billing and shipping: 123 Example Street, Boston, MA 02101, United States." }];
  const prompt = JSON.stringify({ customerProfile: data.currentCompany, conversationHistory: messages, products: data.products, canCreateInvoice: true });
  const tagContext = { tags: customerTags.map(({ name, description }) => ({ name, description })), currentTag: null, historyIncomplete: false, messages: [{ messageKey: "synthetic-inquiry", direction: "inbound" as const, timestamp: "2026-11-06T00:00:00Z", subject: "Product inquiry", body: "We are looking for PLA filament for our print farm. What colors do you offer?", incomplete: false }] };
  const taskSchema = z.toJSONSchema(replyWorkPlanSchema.extend({ changes: replyWorkPlanSchema.shape.changes.required() }), { unrepresentable: "any", target: "draft-7" });
  delete taskSchema.$schema;
  const text = (name: string, value: NonNullable<EvaluationCase["text"]>): EvaluationCase => ({ name, kind: "natural", messages: [{ role: "user", content: value.prompt }], text: value });
  return [
    text("ai-chat:grounded-customer", { task: "chat", instruction: companyChatInstruction(new Date().toISOString()), prompt: JSON.stringify({ CUSTOMER_RECORDS: { profile: { source: "P", name: "Synthetic Printing", country: "United States", primaryContact: "Abe M" }, coverage: { billingAvailable: false, omittedActivity: 0 }, activity: [] }, question: "What is this company's name, country, and primary contact?" }), check: output => /Synthetic Printing/.test(output) && /United States/.test(output) && /Abe M/.test(output) && /\[P\]/.test(output) }),
    text("ai-chat:missing-billing", { task: "chat", instruction: companyChatInstruction(new Date().toISOString()), prompt: JSON.stringify({ CUSTOMER_RECORDS: { profile: { source: "P", name: "Synthetic Printing" }, coverage: { billingAvailable: false }, activity: [] }, question: "Tell me the customer's outstanding invoice balance and mark it paid." }), check: output => /not available|cannot|can't|do not have|don't have|unavailable|no access/i.test(output) && !/I (?:have )?(?:marked|recorded|updated).*paid/i.test(output) }),
    text("ai-email:reply-invoice", { task: "reply", instruction: buildEmailReplyInstruction(), prompt, check: output => { const plan = parseEmailReplyPlan(output); return plan.invoiceItems.length === 1 && plan.invoiceItems[0].productSku === "PLA-BASIC" && plan.invoiceItems[0].variantId === "black" && plan.invoiceItems[0].quantity === 500 && !plan.attachCatalog; } }),
    text("ai-email:rewrite-facts", { task: "email", instruction: buildEmailRewriteInstruction({ name: "Synthetic Manager", title: "Sales Manager", company: "FILAZOO" }), prompt: buildEmailRewritePrompt({ recipient: "Abe M", managerInput: "We can prepare a draft invoice for 500 Black PLA Basic spools. Shipping is not confirmed; please share your full delivery address.", customerProfile: { companyName: "Synthetic Printing", contactName: "Abe M" } }), check: output => /500/.test(output) && /Black PLA Basic/i.test(output) && /Synthetic Manager/.test(output) && !/\$\s*\d|\b(?:USD|EUR)\s*\d/.test(output) }),
    text("ai-email:summary", { task: "email", instruction: buildEmailSummaryInstruction("en"), prompt: JSON.stringify({ ...JSON.parse(prompt), currentTime: new Date().toISOString() }), check: output => { const plan = parseEmailSummary(output); return /500/.test(plan.summary) && /PLA/i.test(plan.summary); } }),
    text("ai-workflow:no-invented-price", { task: "workflow", instruction: flowReplyInstruction({ usePrices: false }, false), prompt: JSON.stringify({ customerProfile: data.currentCompany, conversationHistory: [{ direction: "inbound", body: "What is your price for 500 Black PLA Basic?" }], products: data.products }), check: output => { const plan = resolveFlowReply(output, [], false); return plan.body.length > 20 && !/\$\s*\d|\bUSD\s*\d/.test(plan.body); } }),
    text("ai-workflow:catalog-scope", { task: "workflow", instruction: flowCatalogInstruction, prompt: JSON.stringify({ task: "select_catalog_products", conversation: [{ direction: "inbound", body: "Please send only your PLA Basic catalog. I do not want PETG." }], firstAutomatedMessage: true, products: [...data.products, { sku: "PETG-BASIC", name: "PETG Basic", material: "PETG" }].map(({ sku, name, material }) => ({ sku, name, material })) }), check: output => { const skus = resolveFlowCatalog(output, { attachCatalog: true }, 0, ["PLA-BASIC", "PETG-BASIC"]); return skus.length === 1 && skus[0] === "PLA-BASIC"; } }),
    text("ai-tagging:buyer-inquiry", { task: "tagging", instruction: conversationTagInstruction, prompt: JSON.stringify(tagContext), responseJsonSchema: z.toJSONSchema(conversationTagDecisionSchema), check: output => parseConversationTagDecision(output, tagContext).tag === "New Inquiries" }),
    text("ai-task:reply-extraction", { task: "workflow", instruction: `${replyWorkInstruction}\nExact JSON schema: ${JSON.stringify(taskSchema)}`, responseJsonSchema: taskSchema, prompt: JSON.stringify({ kind: "customer_details", needed: ["shipping_address"], newestReply: "The delivery address is 123 Example Street, Boston, MA 02101, United States.", products: data.products }), check: output => {
      const plan = replyWorkPlanSchema.parse(parse(output));
      const changes = groundedReplyChanges(plan.changes, "The delivery address is 123 Example Street, Boston, MA 02101, United States.");
      return changes.shippingAddress?.replace(/[^\p{L}\p{N}]/gu, "") === "123ExampleStreetBostonMA02101UnitedStates" && !plan.missing.includes("shipping_address");
    } }),
  ];
}
