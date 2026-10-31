import { z } from "zod";
import { conversationTagInstruction, conversationTagContext, conversationTagDecisionSchema, parseConversationTagDecision, conversationTagPrompt, conversationTagOutputTokens } from "../lib/ai/conversation-tagging.ts";
import { generateGeminiText } from "../lib/ai/gemini.ts";
import { generateGatewayText, isGeminiRegionError } from "../lib/ai/gateway.ts";
const apiKey = process.env.GEMINI_API_KEY?.trim();
const token = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
if (!apiKey && !token) throw new Error("AI provider is not configured");
const cases = [
  { expected: "New Inquiries", bodies: ["Hi, we manufacture 3D printer parts. Could you quote 100 kg blue PLA and tell me the available spool sizes?"] },
  { expected: "Quotation Follow-up", bodies: ["Please quote 100 kg blue PLA.", "Here is our firm quote for your requested 100 kg: $8/kg, total $800 excluding freight, valid for 15 days. Please review and let us know whether you would like to proceed."] },
  { expected: "Active Negotiations", bodies: ["Please quote 100 kg blue PLA.", "Our quote is $8/kg, total $800 before freight.", "Can you do $7.50/kg if we buy 200 kg? Also, could you send two samples first?"] },
  { expected: "Payment Follow-up", bodies: ["Please quote 100 kg blue PLA.", "Our quote is $8/kg, total $800, 100% bank transfer before production.", "We accept your quote and those payment terms. Send the invoice; we will transfer on Monday.", "Order PO-204 is confirmed. Invoice INV-204 for $800 has been issued, due Monday before production starts. Please arrange the agreed bank transfer. Payment has not yet been received."] },
  { expected: "Orders in Fulfillment", bodies: ["Please quote 100 kg blue PLA.", "We confirm your accepted order PO-204, $800 for 100 kg. Finance has confirmed receipt of the full $800 payment. Production for your order started today, and it is still being prepared for shipment."] },
  { expected: "Postponed Purchasing", bodies: ["Can you quote 100 kg blue PLA?", "We have paused purchasing until January because our budget is frozen. Please contact me in January rather than proceeding with this purchase now."] },
];
for (const [index, fixture] of cases.entries()) {
  const context = conversationTagContext(fixture.bodies.map((body, i) => ({
    id: `qa-${i}`, messageId: `qa-${index}-${i}@example.test`, subject: "PLA product enquiry", direction: fixture.expected === "Postponed Purchasing" || i % 2 === 0 ? "inbound" as const : "outbound" as const,
    body, bodyLoaded: true, preview: body.slice(0, 160), contact: "synthetic-buyer@example.test", company: "Synthetic buyer", status: "Sent", timestamp: new Date(Date.UTC(2026, 9, 30, i + 1)).toISOString(),
  })), null);
  const common = { systemInstruction: conversationTagInstruction, prompt: conversationTagPrompt(context), maxOutputTokens: conversationTagOutputTokens,
    fetcher: ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(40_000) })) as typeof fetch };
  let output;
  try { output = apiKey ? await generateGeminiText({ ...common, apiKey, model: process.env.GEMINI_EMAIL_MODEL?.trim() || "gemini-3.5-flash-lite", responseJsonSchema: z.toJSONSchema(conversationTagDecisionSchema) }) : await generateGatewayText({ ...common, token: token! }); }
  catch (error) { if (!apiKey || !token || !isGeminiRegionError(error)) throw error; output = await generateGatewayText({ ...common, token }); }
  const decision = parseConversationTagDecision(output, context);
  console.log(JSON.stringify({ expected: fixture.expected, actual: decision.tag, confidence: decision.confidence, pass: decision.tag === fixture.expected }));
  if (decision.tag !== fixture.expected) process.exitCode = 1;
}
