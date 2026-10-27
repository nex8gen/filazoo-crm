// Real database and catalog PDF; AI and SMTP are intercepted. No email is sent.
// node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/verify-flow-email-delivery-test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as nodeModule from "node:module";

// This verification runs on Node 24; the app still uses the Node 20 typings.
type SyncResolver = (specifier: string, context: nodeModule.ResolveHookContext, nextResolve: (specifier: string, context: nodeModule.ResolveHookContext) => nodeModule.ResolveFnOutput) => nodeModule.ResolveFnOutput;
const { registerHooks } = nodeModule as typeof nodeModule & {
  registerHooks(hooks: { resolve: SyncResolver }): { deregister(): void };
};

process.env.DRY_RUN = "true";
process.env.GEMINI_API_KEY = "intercepted-verification-only";
const counters = { smtp: 0, ai: 0 };
Object.assign(globalThis, { __flowDeliveryVerification: counters });
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    // Defense in depth: even an unexpected mailer import cannot open SMTP.
    if (specifier === "nodemailer") throw new Error("Real SMTP is forbidden during verification.");
    if (specifier.endsWith("/mailer.ts")) return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent("export async function sendMailboxEmail(_sender, message) { if (message.to !== 'flow-test@example.invalid') throw new Error('Unexpected test recipient'); globalThis.__flowDeliveryVerification.smtp++; return {messageId: '<flow-test-intercepted@example.invalid>'}; }")}` };
    return nextResolve(specifier, context);
  },
});
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith("https://generativelanguage.googleapis.com/")) {
    counters.ai++;
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ subject: "Product catalog test", body: "Hi Test,\n\nThe product catalog is attached. Which material and quantity do you need?", quotes: [] }) }] } }] });
  }
  if (url.startsWith("https://ai-gateway.vercel.sh/")) throw new Error("Unexpected AI fallback during verification.");
  return originalFetch(input, init);
};
const { createSupabaseAdmin } = await import("../lib/supabase/admin.ts");
const { flowEmailDeliveryTestSchema } = await import("../lib/flow-email-test.ts");
const { blankStep } = await import("../lib/flows.ts");
const { startFlowEmailDeliveryTest, processFlowEmailDeliveryTest } = await import("../lib/data/flow-email-delivery-test.ts");
const admin = createSupabaseAdmin();
const id = randomUUID();
const { data: member } = await admin.from("workspace_members").select("user_id,display_name").eq("role", "admin").not("activated_at", "is", null).limit(1).single().throwOnError();
const userId = member!.user_id;
try {
  const input = flowEmailDeliveryTestSchema.parse({ requestId: id, recipient: "flow-test@example.invalid", customerName: "Test", companyName: "Verification only",
    flow: { name: "Disposable delivery verification", triggerType: "new_lead", triggerConfig: {}, status: "draft", steps: [{ type: "wait", config: { amount: 2, unit: "minutes" } }, blankStep("ai_auto_reply")] },
    emails: [{ from: "sample@example.invalid", subject: "Catalog inquiry", body: "Please send your catalog." }] });
  const started = await startFlowEmailDeliveryTest(input, userId, member!.display_name);
  assert.ok(Date.parse(started.next_run_at!) - Date.parse(started.created_at) >= 119_000);
  assert.equal((await processFlowEmailDeliveryTest(id, userId)).status, "waiting");
  assert.equal(counters.smtp, 0); assert.equal(counters.ai, 0);
  assert.equal((await startFlowEmailDeliveryTest(input, userId, null)).id, id);
  console.log("PASS real test starts on a draft, persists the two-minute wait and does not send early");
  // Advance only this synthetic run to avoid waiting or touching any live flow.
  await admin.from("flow_email_test_runs").update({ next_run_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id).eq("user_id", userId).throwOnError();
  const completed = await processFlowEmailDeliveryTest(id, userId);
  assert.equal(completed.status, "completed", completed.error || "");
  assert.equal(completed.result.length, 1);
  assert.equal(completed.result[0].messageId, "<flow-test-intercepted@example.invalid>");
  assert.equal(completed.result[0].attachments.length, 1);
  assert.ok(completed.result[0].attachments[0].size > 100);
  assert.equal(counters.smtp, 1); assert.equal(counters.ai, 1);
  await processFlowEmailDeliveryTest(id, userId);
  assert.equal(counters.smtp, 1);
  const { count: sent } = await admin.from("mailbox_sent_messages").select("id", { count: "exact", head: true }).eq("thread_key", `flow-test:${id}`).throwOnError();
  assert.equal(sent, 1);
  console.log("PASS due test uses the live AI/PDF pipeline, checkpoints SMTP acceptance in Sent and never resends");
} finally {
  const { data: sent } = await admin.from("mailbox_sent_messages").select("attachments").eq("thread_key", `flow-test:${id}`).eq("user_id", userId).throwOnError();
  const paths = (sent ?? []).flatMap((row) => (row.attachments ?? []).map((attachment: { path: string }) => attachment.path));
  if (paths.length) await admin.storage.from("mailbox-attachments").remove(paths);
  await admin.from("mailbox_sent_messages").delete().eq("thread_key", `flow-test:${id}`).eq("user_id", userId).throwOnError();
  await admin.from("flow_email_test_runs").delete().eq("id", id).eq("user_id", userId).throwOnError();
  globalThis.fetch = originalFetch; hook.deregister(); Reflect.deleteProperty(globalThis, "__flowDeliveryVerification");
  console.log("Disposable delivery test and attachments removed. No email was sent.");
}
