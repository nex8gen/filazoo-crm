// Run from a supported Google API region. One idempotent, workspace-only real AI email test.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createSupabaseAdmin } from "../lib/supabase/admin.ts";
import { normalizeMailboxRow } from "../lib/mailbox-utils.ts";
import { blankStep, type JsonConfig } from "../lib/flows.ts";
import { flowEmailDeliveryTestSchema } from "../lib/flow-email-test.ts";
import { startFlowEmailDeliveryTest, processFlowEmailDeliveryTest } from "../lib/data/flow-email-delivery-test.ts";
import { receiveMailboxMessages, closeMailboxSessions } from "../lib/mailbox-imap.ts";

const checkpoint = JSON.parse(readFileSync("docs/audit-evidence/flow-live-ai-email-checkpoint-20261030.json", "utf8")) as { id: string };
const evidencePath = "docs/audit-evidence/flow-live-ai-email-20261030.json";
const admin = createSupabaseAdmin();
const { data: sender } = await admin.from("workspace_mailboxes").select("*").eq("type", "workspace").eq("is_default", true).eq("is_active", true).single().throwOnError();
const mailbox = normalizeMailboxRow(sender);
assert.ok(mailbox?.email);
assert.equal(mailbox.email.toLowerCase(), "raul@filazoo.com", "This approved test may only target raul@filazoo.com.");
const { data: member } = await admin.from("workspace_members").select("user_id,display_name").eq("role", "admin").not("activated_at", "is", null).limit(1).single().throwOnError();
assert.ok(member);
const ai = { ...blankStep("ai_auto_reply"), config: { ...blankStep("ai_auto_reply").config, instructions: "This is an internal workflow test. Answer the product catalog request, ask for material and quantity, and do not invent prices.", usePrices: false } };
const inner = blankStep("split"), outer = blankStep("split");
inner.config.paths = [{ id: "high-fit", name: "High fit", condition: { field: "fit_score_at_least", fitScore: 7 }, steps: [{ ...blankStep("wait"), config: { amount: 1, unit: "minutes" } }, ai] }, { id: "other-fit", name: "Other fit", condition: null, steps: [blankStep("stop")] }] as unknown as JsonConfig["paths"];
outer.config.paths = [{ id: "us", name: "US", condition: { field: "country_is", value: "US" }, steps: [inner] }, { id: "other-country", name: "Other country", condition: null, steps: [blankStep("stop")] }] as unknown as JsonConfig["paths"];
const input = flowEmailDeliveryTestSchema.parse({ requestId: checkpoint.id, recipient: mailbox.email, customerName: "Workflow QA", companyName: "Internal workflow verification",
  flow: { name: "Supported-region nested AI verification", status: "draft", triggerType: "email_received", triggerConfig: {}, steps: [outer] },
  facts: { country: "US", fitScore: 8 }, emails: [{ from: "workflow-qa@example.invalid", subject: `Workflow QA ${checkpoint.id.slice(0, 8)}`, body: "Please send your product catalog. We are evaluating filament for our business. This is an internal test." }] });
let run = await startFlowEmailDeliveryTest(input, member.user_id, member.display_name);
console.log(`START nested AI test: ${run.id}; ${run.status}`);
const expires = Date.now() + 240_000;
try {
  while (run.status === "waiting" && Date.now() < expires) {
    run = await processFlowEmailDeliveryTest(run.id, member.user_id);
    if (run.status === "waiting") await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  writeFileSync(evidencePath, JSON.stringify({ checkedAt: new Date().toISOString(), region: "iad1", run }, null, 2));
  assert.equal(run.status, "completed", run.error || "AI test did not finish.");
  assert.equal(run.result.length, 1);
  assert.ok(run.result[0].attachments.some((item) => item.filename.endsWith(".pdf") && item.size > 100));
  assert.ok(Date.parse(run.result[0].sentAt) - Date.parse(run.created_at) >= 59_000, "Configured wait must elapse before actual delivery.");
  const repeat = await processFlowEmailDeliveryTest(run.id, member.user_id);
  assert.equal(repeat.result.length, 1, "Completed retry must never send again.");
  console.log("PASS real Gemini generation, catalog PDF, elapsed wait, SMTP acceptance and no duplicate on retry.");
  let received;
  for (let attempt = 0; attempt < 8 && !received; attempt++) {
    const messages = await receiveMailboxMessages(mailbox, { limit: 20, headersOnly: true, includePreview: false });
    received = messages.find((message) => message.messageId === run.result[0].messageId);
    if (!received) { await closeMailboxSessions(); await new Promise((resolve) => setTimeout(resolve, 5000)); }
  }
  const evidence = { checkedAt: new Date().toISOString(), region: "iad1", run, received: received ? { messageId: received.messageId, subject: received.subject, attachments: received.attachments?.map((item) => ({ filename: item.filename, size: item.size })) } : null };
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  assert.ok(received, "SMTP succeeded but the message was not found in the test inbox.");
  assert.ok(received.attachments?.some((item) => item.filename.endsWith(".pdf")), "The received MIME must contain the catalog PDF.");
  console.log(`PASS IMAP receipt with catalog PDF; evidence: ${evidencePath}`);
} finally { await closeMailboxSessions(); }
