// node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/verify-flow-ai-reply.ts
// Disposable CRM records; provider requests are intercepted and SMTP is forced to dry-run.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.DRY_RUN = "true";
process.env.GEMINI_API_KEY = "verification-only-intercepted";
const { createSupabaseAdmin } = await import("../lib/supabase/admin.ts");
const { blankStep } = await import("../lib/flows.ts");
const { enrollMatchingFlows, scanTimeBasedFlowTriggers, processFlowRun } = await import("../lib/data/flow-runtime.ts");
const { prepareFlowAiReply } = await import("../lib/data/flow-ai-reply.ts");
const admin = createSupabaseAdmin();
const prefix = `AI flow verification ${randomUUID()}`;
const { data: member } = await admin.from("workspace_members").select("user_id").eq("role", "admin").not("activated_at", "is", null).limit(1).single().throwOnError();
const userId = member!.user_id;
let companyId: string | undefined;
let flowId: string | undefined;
const originalFetch = globalThis.fetch;
let providerRequests = 0;
let expectedCatalog = true;
let expectedProducts = true;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith("https://generativelanguage.googleapis.com/")) {
    providerRequests += 1;
    const request = JSON.parse(String(init?.body));
    const context = JSON.parse(request.contents[0].parts[0].text);
    assert.equal(context.conversation.at(-1).body, "Please tell me about black PLA for our print farm.");
    if (context.task === "select_catalog_products") {
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: "none", scope: "all", productSkus: [] }) }] } }] });
    }
    assert.equal(context.catalogAttached, expectedCatalog);
    assert.equal(context.products.length > 0, expectedProducts);
    if (expectedProducts) assert.ok(context.products[0].pricing);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ subject: "PLA information", body: expectedCatalog ? "Hi Test,\n\nThank you for your PLA inquiry. The product catalog is attached. What quantities do you need?" : "Hi Test,\n\nWhat quantities do you need?", quotes: [] }) }] } }] });
  }
  if (url.startsWith("https://ai-gateway.vercel.sh/")) throw new Error("Unexpected provider fallback in verification.");
  return originalFetch(input, init);
};

try {
  const { data: company } = await admin.from("companies").insert({ name: prefix, segment: prefix, country: "US", status: "new" }).select("id").single().throwOnError();
  companyId = company!.id;
  const { data: oldContact } = await admin.from("contacts").insert({ company_id: companyId, name: "Old Test", email: `old-${randomUUID()}@example.com`, verification_status: "valid" }).select("id").single().throwOnError();
  const aiStep = blankStep("ai_auto_reply");
  const { data: saved } = await admin.rpc("save_automation_flow", { p_user_id: userId, p_flow_id: null, p_input: { name: prefix, triggerType: "new_lead", triggerConfig: { segment: prefix }, status: "live", steps: [{ type: "wait", config: { amount: 5, unit: "minutes", businessDays: false, resumeAt: "" } }, aiStep] } }).throwOnError();
  flowId = saved;
  const { data: definition } = await admin.from("flows").select("lead_enrollment_started_at,flow_steps(type,config)").eq("id", flowId!).single().throwOnError();
  assert.ok(definition!.lead_enrollment_started_at);
  assert.ok(definition!.flow_steps.some((step) => step.type === "ai_auto_reply"));
  const { data: contact } = await admin.from("contacts").insert({ company_id: companyId, name: "Test", email: `new-${randomUUID()}@example.com`, verification_status: "valid" }).select("id").single().throwOnError();
  const contactId = contact!.id;
  const event = { type: "new_lead" as const, flowId: flowId!, contactId, conversationId: "intake" };
  assert.equal((await enrollMatchingFlows(event))[0]?.reason, "waiting");
  assert.equal((await enrollMatchingFlows({ ...event, contactId: oldContact!.id })).length, 0);
  assert.equal((await enrollMatchingFlows({ ...event, eventKey: randomUUID() }))[0]?.enrolled, false);
  assert.equal(await scanTimeBasedFlowTriggers(flowId!), 0);
  const { data: runs } = await admin.from("flow_runs").select("id,contact_id,next_run_at,started_at,conversation_id").eq("flow_id", flowId!).throwOnError();
  assert.equal(runs!.length, 1);
  const run = runs![0];
  assert.equal(run.contact_id, contactId);
  assert.notEqual(run.contact_id, oldContact!.id);
  assert.ok(Date.parse(run.next_run_at) - Date.parse(run.started_at) >= 299000);
  console.log("PASS immediate new-lead enrollment excludes old leads, deduplicates intake/scanner retries and persists the five-minute wait");

  const inboundId = `<${randomUUID()}@example.com>`;
  await admin.from("emails").insert({ contact_id: contactId, direction: "received", status: "received", subject: "Black PLA", body: "Please tell me about black PLA for our print farm.", thread_id: `message:${inboundId}`, message_id: inboundId, owner_id: userId }).throwOnError();
  const args = { userId, contactId, companyId: companyId!, conversationId: run.conversation_id, config: aiStep.config };
  const reply = await prepareFlowAiReply(args);
  assert.equal(reply.inReplyTo, inboundId);
  assert.equal(reply.subject, "Re: Black PLA");
  assert.equal(reply.attachments.length, 1);
  assert.equal(reply.attachments[0].content.subarray(0, 4).toString(), "%PDF");
  assert.match(reply.body, /Filazoo/);
  console.log("PASS generation reads email received during the wait, current products/prices, real PDF and reply headers");

  await admin.from("flow_run_logs").insert({ run_id: run.id, result: { action: "email_sent", catalogAttached: true } }).throwOnError();
  expectedCatalog = false;
  const secondReply = await prepareFlowAiReply(args);
  assert.equal(secondReply.attachments.length, 0);
  expectedProducts = false;
  await prepareFlowAiReply({ ...args, config: { ...aiStep.config, useProducts: false, usePrices: false, attachCatalog: false } });
  console.log("PASS later replies omit the catalog and disabled product/price lookup supplies no product data");

  await admin.from("flow_runs").update({ next_run_at: new Date(Date.now() - 1000).toISOString() }).eq("id", run.id).throwOnError();
  const requestsBefore = providerRequests;
  const execution = await processFlowRun(run.id);
  assert.equal(execution.status, "done");
  assert.equal(providerRequests, requestsBefore);
  const { count: dryRuns } = await admin.from("flow_run_logs").select("id", { count: "exact", head: true }).eq("run_id", run.id).eq("result->>action", "email_dry_run").throwOnError();
  assert.equal(dryRuns, 1);
  console.log("PASS runtime completes AI replies in dry-run without AI calls or SMTP delivery, even after an inbound reply");

  await admin.from("flows").update({ status: "paused" }).eq("id", flowId!).throwOnError();
  const { data: paused } = await admin.from("flows").select("lead_enrollment_started_at").eq("id", flowId!).single().throwOnError();
  assert.equal(paused!.lead_enrollment_started_at, null);
  console.log("PASS pausing resets the new-lead enrollment boundary");
} finally {
  globalThis.fetch = originalFetch;
  if (flowId) await admin.from("flows").delete().eq("id", flowId).throwOnError();
  if (companyId) await admin.from("companies").delete().eq("id", companyId).throwOnError();
  console.log("Disposable verification records removed.");
}
