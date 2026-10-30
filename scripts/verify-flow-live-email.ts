// Explicit real-email verification: sends only to the configured workspace mailbox.
// Keeps test-run/Sent history and a small evidence file. Never activates a customer flow.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { createSupabaseAdmin } from "../lib/supabase/admin.ts";
import { normalizeMailboxRow } from "../lib/mailbox-utils.ts";
import { flowEmailDeliveryTestSchema } from "../lib/flow-email-test.ts";
import { blankStep, type FlowInput, type JsonConfig } from "../lib/flows.ts";
import { startFlowEmailDeliveryTest, processFlowEmailDeliveryTest } from "../lib/data/flow-email-delivery-test.ts";
import { receiveMailboxMessages, closeMailboxSessions } from "../lib/mailbox-imap.ts";

const evidencePath = "docs/audit-evidence/flow-live-email-20261030.json";
const checkpointPath = "docs/audit-evidence/flow-live-email-checkpoint-20261030.json";
const admin = createSupabaseAdmin();
const { data: sender } = await admin.from("workspace_mailboxes").select("*").eq("type", "workspace").eq("is_default", true).eq("is_active", true).single().throwOnError();
const mailbox = normalizeMailboxRow(sender);
assert.ok(mailbox?.email && mailbox.imapHost, "Workspace test mailbox requires SMTP and IMAP.");
const { data: member } = await admin.from("workspace_members").select("user_id,display_name").eq("role", "admin").not("activated_at", "is", null).limit(1).single().throwOnError();
assert.ok(member);
const saved = existsSync(checkpointPath) ? JSON.parse(readFileSync(checkpointPath, "utf8")) as { token: string; ids: string[] } : { token: `workflow-qa-${randomUUID().slice(0, 8)}`, ids: [randomUUID(), randomUUID()] };
writeFileSync(checkpointPath, JSON.stringify(saved, null, 2));
const { token, ids } = saved;
const template = (label: string, catalog = false) => ({ ...blankStep("send_email"), config: { ...blankStep("send_email").config, templateId: catalog ? "send_catalog" : "welcome_intro", subject: `${token} ${label}`, body: "Hello {{first_name}},\n\nThis is the requested automated workflow verification. No customer action is needed.", sendWindow: "anytime" } });
const ai = { ...blankStep("ai_auto_reply"), config: { ...blankStep("ai_auto_reply").config, instructions: `This is an internal workflow test. Include ${token} in the subject. Acknowledge the catalog request. Do not invent prices or specifications.`, useProducts: true, usePrices: false, attachCatalog: true, sendWindow: "anytime" } };
const inner = blankStep("split");
inner.config.paths = [{ id: "fit", name: "High fit", condition: { field: "fit_score_at_least", fitScore: 7 }, steps: [template("nested match"), { ...blankStep("wait"), config: { amount: 1, unit: "minutes" } }, ai] }, { id: "fit-else", name: "Other fit", condition: null, steps: [blankStep("stop")] }] as unknown as JsonConfig["paths"];
const outer = blankStep("split");
outer.config.paths = [{ id: "us", name: "US", condition: { field: "country_is", value: "US" }, steps: [inner] }, { id: "other", name: "Everyone else", condition: null, steps: [template("fallback catalog", true)] }] as unknown as JsonConfig["paths"];
const flow: FlowInput = { name: token, status: "draft", triggerType: "email_received", triggerConfig: {}, steps: [outer, blankStep("create_task"), blankStep("stop")] };
const reports = [];
try {
  for (const [index, country] of ["US", "GB"].entries()) {
    const { data: previous } = await admin.from("flow_email_test_runs").select("status,result,error").eq("id", ids[index]).eq("user_id", member.user_id).maybeSingle().throwOnError();
    if (previous?.status === "failed" && previous.result?.length === 0 && /attachment|^Connection timeout$|^SMTP connection failed before submission:/i.test(previous.error || "")) {
      ids[index] = randomUUID();
      writeFileSync(checkpointPath, JSON.stringify(saved, null, 2));
      console.log(`RETEST ${country}: prior failure was before email submission`);
    }
    const input = flowEmailDeliveryTestSchema.parse({ requestId: ids[index], recipient: mailbox.email, customerName: "Workflow QA", companyName: "Internal test", firstMessage: true,
      flow, facts: { country, fitScore: 8 }, emails: [{ from: "workflow-qa@example.invalid", subject: `${token} catalog inquiry`, body: "Please send your filament product catalog. This is an internal test." }] });
    let run = await startFlowEmailDeliveryTest(input, member.user_id, member.display_name);
    console.log(`START ${country}: ${run.id} ${run.status}`);
    const deadline = Date.now() + 180_000;
    while (run.status === "waiting" && Date.now() < deadline) {
      run = await processFlowEmailDeliveryTest(run.id, member.user_id);
      if (run.status === "waiting") await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, Math.max(500, Date.parse(run.next_run_at || "") - Date.now()))));
    }
    if (run.status !== "completed") console.log(`FAIL ${country}: ${run.error || run.status}`);
    else assert.equal(run.result.length, country === "US" ? 2 : 1);
    const repeated = await processFlowEmailDeliveryTest(run.id, member.user_id);
    assert.equal(repeated.result.length, run.result.length, "Completed test must never resend.");
    console.log(`CHECK ${country}: ${run.result.length} SMTP-accepted messages; terminal retry did not resend`);
    reports.push({ country, run });
  }
  const expected = reports.flatMap(({ run }) => run.result);
  const found = new Map<string, { subject: string; messageId: string | null; attachments: number }>();
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && found.size < expected.length) {
    const messages = await receiveMailboxMessages(mailbox, { limit: 20, headersOnly: true, includePreview: false });
    for (const message of messages) {
      const match = expected.find((reply) => reply.messageId && reply.messageId === message.messageId);
      if (match) found.set(match.messageId!, { subject: message.subject, messageId: message.messageId ?? null, attachments: message.attachments?.length ?? 0 });
    }
    if (found.size < expected.length) { await closeMailboxSessions(); await new Promise((resolve) => setTimeout(resolve, 10_000)); }
  }
  const evidence = { checkedAt: new Date().toISOString(), recipient: mailbox.email, token, realEmailCount: expected.length, receivedCount: found.size, reports, received: [...found.values()] };
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  assert.equal(found.size, expected.length, "SMTP succeeded but not every message was found in the test inbox; inspect evidence.");
  assert.ok(expected.some((reply) => reply.attachments.length), "Catalog attachment was expected.");
  console.log(`PASS IMAP receipt: ${found.size}/${expected.length}; evidence: ${evidencePath}`);
  assert.ok(reports.every(({ run }) => run.status === "completed"), "Some real test actions failed; inspect the evidence for provider errors.");
} finally { await closeMailboxSessions(); }
