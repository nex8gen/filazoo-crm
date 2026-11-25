import { generateGatewayText } from "../lib/ai/gateway.ts";
import { resolveGatewayTokenAsync } from "../lib/ai/provider-credentials.ts";
import { flowAuthoredText, flowCatalogInstruction, flowReplyInstruction, resolveFlowCatalog, resolveFlowReply, flowReplyPlanSchema } from "../lib/ai/flow-reply.ts";

const products = [{ sku: "PLA", name: "PLA Basic", material: "PLA", diameter: "1.75mm", weight: "1kg", color: "Black", variants: [{ id: "black", name: "Black" }, { id: "white", name: "White" }] }, { sku: "PETG", name: "PETG Basic", material: "PETG", diameter: "1.75mm", weight: "1kg", color: "Black", variants: [] }];
const cases = [
  { name: "catalog-without-qualification", customer: "Can you send me the PLA catalog?", catalog: true, action: "reply", skus: ["PLA"], maxQuestions: 0 },
  { name: "acknowledgment-with-quoted-request", customer: "OK\n\nSent&nbsp;from&nbsp;my&nbsp;iPhone\n\n------------------ Original ------------------\nFrom: Sales\nDate: Yesterday\nPlease send the PLA catalog.", catalog: true, action: "skip", skus: [], maxQuestions: 0, previous: "The PLA catalog PDF is attached for your review." },
  { name: "invoice-instead-of-repeat-pricing", customer: "Now can you send me the invoice for the 100 black PLA Basic spools we agreed?", catalog: false, action: "review", maxQuestions: 0 },
  { name: "known-requirements-pricing-disabled", customer: "Please confirm a quote for 100 black PLA Basic 1kg spools. Delivery is to our saved address.", catalog: false, action: "review", maxQuestions: 0 },
  { name: "resend-after-prior-catalog", customer: "I did not receive it. Please resend the PLA catalog.", catalog: true, action: "reply", skus: ["PLA"], maxQuestions: 0, previous: "The PLA catalog is attached." },
  { name: "unavailable-product-no-unrelated-catalog", customer: "Please send only your TPU 95A catalog, not PLA or PETG.", catalog: true, action: "reply", skus: [], maxQuestions: 1 },
  { name: "answer-known-spec-without-questions", customer: "What diameter PLA Basic do you supply?", catalog: false, action: "reply", maxQuestions: 0, answer: /1\.75/ },
  { name: "refund-needs-human-review", customer: "My delivery arrived damaged. Please refund my order.", catalog: false, action: "review", maxQuestions: 0 },
];
const selectedCase = process.argv.find(value => value.startsWith("--case="))?.slice(7);
const selected = cases.filter(scenario => !selectedCase || scenario.name === selectedCase);
if (!selected.length) throw new Error("Choose an existing synthetic case name.");
const parse = (output: string) => JSON.parse(output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
if (!process.argv.includes("--live")) console.log(JSON.stringify({ live: false, syntheticOnly: true, sendsEmail: false, cases: cases.map(item => item.name) }, null, 2));
else {
  const token = await resolveGatewayTokenAsync(process.env);
  if (!token) throw new Error("Configure the existing AI provider before running this evaluation.");
  let failed = 0;
  for (const scenario of selected) {
    try {
      const config = { attachCatalog: scenario.catalog, catalogFirstMessageOnly: true, useProducts: true, usePrices: false };
      const conversation = [...(scenario.previous ? [{ direction: "sent", body: scenario.previous, created_at: "2026-11-24T01:00:00Z" }] : []), { direction: "received", body: flowAuthoredText(scenario.customer), quotedHistory: scenario.customer, created_at: "2026-11-25T01:00:00Z" }];
      const generate = (instruction: string, context: unknown) => generateGatewayText({ token, task: "reply", systemInstruction: instruction, prompt: JSON.stringify(context), maxOutputTokens: 2000, signal: AbortSignal.timeout(55_000) });
      const catalogOutput = scenario.catalog ? await generate(flowCatalogInstruction, { task: "select_catalog_products", conversation, products, firstAutomatedMessage: false, previouslyDeliveredCatalogs: scenario.previous ? 1 : 0 }) : null;
      const skus = catalogOutput ? resolveFlowCatalog(catalogOutput, config, 1, products.map(product => product.sku)) : [];
      const output = await generate(flowReplyInstruction(config, skus.length > 0), { recipient: { name: "Synthetic Buyer" }, conversation, products,
        catalogAttached: skus.length > 0, attachedCatalogProducts: products.filter(product => skus.includes(product.sku)), catalogDecision: catalogOutput ? parse(catalogOutput) : null,
        approvedBusinessFacts: { status: "unavailable", records: [] } });
      const plan = flowReplyPlanSchema.parse(parse(output));
      if (plan.action === "reply") resolveFlowReply(output, [], false);
      const passed = plan.action === scenario.action && (plan.body.match(/\?/g) ?? []).length <= scenario.maxQuestions
        && (!scenario.skus || JSON.stringify([...skus].sort()) === JSON.stringify([...scenario.skus].sort()))
        && (!scenario.answer || scenario.answer.test(plan.body)) && (plan.action === "reply" || !plan.body)
        && !/supplied records|\bCRM\b|model decision|prompt|internal rules/i.test(plan.body)
        && (!skus.length || /attach|enclos/i.test(plan.body));
      const unsupportedClaim = scenario.name === "unavailable-product-no-unrelated-catalog" && /only offer|do not carry|do not manufacture|PLA and PETG options/i.test(plan.body);
      if (!passed || unsupportedClaim) failed++;
      console.log(JSON.stringify({ case: scenario.name, passed: passed && !unsupportedClaim, catalogSkus: skus, action: plan.action, body: plan.body }));
    } catch (error) {
      failed++;
      console.log(JSON.stringify({ case: scenario.name, passed: false, error: error instanceof Error ? error.message : "Evaluation failed" }));
    }
  }
  console.log(JSON.stringify({ cases: selected.length, passed: selected.length - failed, failed }));
  if (failed) process.exitCode = 1;
}
