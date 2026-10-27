import "server-only";
import { randomUUID } from "node:crypto";
import { flowEmailDeliveryTestSchema, type FlowEmailDeliveryTestInput, type FlowEmailDeliveryTestRun } from "../flow-email-test.ts";
import { simulateFlow, type FlowFacts } from "../flow-engine.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { env } from "../env.ts";
import { evaluateSend } from "../outreach-policy.ts";
import { sendMailboxEmail } from "../mailer.ts";
import { buildFlowEmail } from "../flow-tracking.ts";
import { emailTemplates, getFlowTestMailbox } from "./flow-runtime.ts";
import { generateFlowAiReply, hasFlowReplyProvider, loadFlowReplyProducts, prepareFlowTemplateCatalog } from "./flow-ai-reply.ts";

type PlanAction = { step: number; sendAt: string };
type TestRow = FlowEmailDeliveryTestRun & {
  user_id: string; input: FlowEmailDeliveryTestInput; plan: PlanAction[]; manager_name: string | null;
  current_action: number; locked_at: string | null; expires_at: string;
};
const table = "flow_email_test_runs";

export function planFlowEmailDeliveryTest(input: FlowEmailDeliveryTestInput, now = new Date()): PlanAction[] {
  const config = input.flow.triggerConfig;
  const facts: FlowFacts = { customerReplied: false, openedEmail: false, clickedLink: false,
    category: typeof config.category === "string" ? config.category : null,
    segment: typeof config.segment === "string" ? config.segment : null,
    country: typeof config.country === "string" ? config.country : null,
    companyStatus: typeof config.companyStatus === "string" ? config.companyStatus : null,
    pipelineStage: typeof config.pipelineStage === "string" ? config.pipelineStage : null,
    fitScore: typeof config.minFitScore === "number" ? config.minFitScore : null };
  const trace = simulateFlow(input.flow, facts, now).trace;
  const actions: PlanAction[] = [];
  let sendAt = now.toISOString();
  for (const entry of trace) {
    if (entry.scheduledAt) sendAt = entry.scheduledAt;
    if (entry.status === "would_run" && (entry.type === "send_email" || entry.type === "ai_auto_reply")) actions.push({ step: entry.step, sendAt });
  }
  if (!actions.length) throw new Error("This test path does not send an email. Review the flow conditions.");
  if (actions.length > 6) throw new Error("Test up to six email actions at a time.");
  if (actions.some((action) => Date.parse(action.sendAt) > now.getTime() + 3_600_000)) throw new Error("For a real test, shorten the total wait to one hour or less.");
  return actions;
}

function publicRun(row: TestRow): FlowEmailDeliveryTestRun {
  return { id: row.id, recipient: row.recipient, status: row.status, next_run_at: row.next_run_at, created_at: row.created_at, result: row.result, error: row.error };
}

export async function loadFlowEmailDeliveryTest(id: string, userId: string) {
  const { data } = await createSupabaseAdmin().from(table).select("*").eq("id", id).eq("user_id", userId).maybeSingle().throwOnError();
  if (!data) throw new Error("Test run not found.");
  return publicRun(data as TestRow);
}

export async function startFlowEmailDeliveryTest(input: FlowEmailDeliveryTestInput, userId: string, managerName: string | null) {
  const admin = createSupabaseAdmin();
  const existing = await admin.from(table).select("*").eq("id", input.requestId).eq("user_id", userId).maybeSingle().throwOnError();
  if (existing.data) return publicRun(existing.data as TestRow);
  let plan = planFlowEmailDeliveryTest(input);
  for (const action of plan) {
    const step = input.flow.steps[action.step - 1];
    const mailbox = await getFlowTestMailbox(userId, step.config.mailboxId);
    if (!mailbox?.smtpHost || !mailbox.smtpUsername || !mailbox.smtpPassword) throw new Error("The test sender needs an active mailbox with complete SMTP settings.");
    if (step.type === "ai_auto_reply" && !hasFlowReplyProvider()) throw new Error("Configure an AI provider before sending an AI test reply.");
  }
  const { count: active } = await admin.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "waiting").gt("expires_at", new Date().toISOString()).throwOnError();
  if ((active ?? 0) >= 3) throw new Error("Finish or cancel an existing delivery test before starting another.");
  const startedAt = new Date();
  plan = planFlowEmailDeliveryTest(input, startedAt);
  const { data, error } = await admin.from(table).insert({ id: input.requestId, user_id: userId, recipient: input.recipient,
    input, plan, manager_name: managerName, created_at: startedAt.toISOString(), next_run_at: plan[0].sendAt }).select("*").single();
  if (error) {
    if (error.code === "23505") return loadFlowEmailDeliveryTest(input.requestId, userId);
    throw new Error(`Unable to start delivery test: ${error.message}`);
  }
  return publicRun(data as TestRow);
}

export async function cancelFlowEmailDeliveryTest(id: string, userId: string) {
  const { data } = await createSupabaseAdmin().from(table).update({ status: "cancelled", next_run_at: null, finished_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", userId).eq("status", "waiting").is("locked_at", null).select("id").maybeSingle().throwOnError();
  if (!data) throw new Error("This test has finished or is sending an email. Refresh its status.");
  return loadFlowEmailDeliveryTest(id, userId);
}

export async function processFlowEmailDeliveryTest(id: string, userId: string) {
  const admin = createSupabaseAdmin();
  const { data } = await admin.from(table).select("*").eq("id", id).eq("user_id", userId).maybeSingle().throwOnError();
  if (!data) throw new Error("Test run not found.");
  const row = data as TestRow;
  if (row.status !== "waiting") return publicRun(row);
  // Never retry an interrupted SMTP action: the provider may have accepted it.
  if (Date.parse(row.expires_at) < Date.now() || (row.locked_at && Date.parse(row.locked_at) < Date.now() - 300_000)) {
    const error = "Test execution expired or was interrupted. Check Sent before starting another test.";
    await admin.from(table).update({ status: "failed", error, next_run_at: null, finished_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId).throwOnError();
    return { ...publicRun(row), status: "failed" as const, error, next_run_at: null };
  }
  if (row.locked_at || (row.next_run_at && Date.parse(row.next_run_at) > Date.now())) return publicRun(row);
  const { data: claimed } = await admin.from(table).update({ locked_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", userId).eq("status", "waiting").is("locked_at", null).select("id").maybeSingle().throwOnError();
  if (!claimed) return loadFlowEmailDeliveryTest(id, userId);
  const uploadedPaths: string[] = [];
  let smtpAccepted = false;
  try {
    const input = flowEmailDeliveryTestSchema.parse(row.input);
    const action = row.plan[row.current_action];
    const step = input.flow.steps[action.step - 1];
    const mailbox = await getFlowTestMailbox(userId, step.config.mailboxId);
    if (!mailbox?.smtpHost || !mailbox.smtpUsername || !mailbox.smtpPassword) throw new Error("The selected test sender mailbox is unavailable.");
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const [{ count: sentToday }, { count: suppressed }, { count: unsubscribed }] = await Promise.all([
      admin.from("mailbox_sent_messages").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("sent_at", today.toISOString()).throwOnError(),
      admin.from("suppression").select("email", { count: "exact", head: true }).eq("email", row.recipient).throwOnError(),
      admin.from("contacts").select("id", { count: "exact", head: true }).eq("email", row.recipient).eq("unsubscribed", true).throwOnError(),
    ]);
    // This address is explicitly supplied for a real test, without manufacturing
    // a verified CRM contact or changing production DRY_RUN configuration.
    const decision = evaluateSend({ email: row.recipient, verified: true, unsubscribed: Boolean(unsubscribed), suppressed: Boolean(suppressed), sentToday: sentToday ?? 0,
      dailyLimit: env.DAILY_SEND_LIMIT, bounceRate: 0, bouncePausePercent: env.BOUNCE_PAUSE_PERCENT, dryRun: false });
    if (!decision.allowed) throw new Error(decision.reason);
    const sample = input.emails[0];
    const history = [{ subject: sample.subject, body: sample.body, direction: "received", created_at: row.created_at },
      ...row.result.map((reply) => ({ subject: reply.subject, body: reply.body, direction: "sent", created_at: reply.sentAt }))].reverse();
    const template = emailTemplates[String(step.config.templateId)];
    const firstName = input.customerName.trim().split(/\s+/)[0] || sample.from.split("@")[0];
    const render = (value: string) => value.replaceAll("{{first_name}}", firstName);
    const reply = step.type === "ai_auto_reply" ? await generateFlowAiReply({ config: step.config, contact: { name: input.customerName, email: sample.from },
      company: { name: input.companyName }, managerName: row.manager_name, messages: history,
      productRows: await loadFlowReplyProducts(step.config), previousAutomatedMessages: row.result.length + (input.firstMessage ? 0 : 1) })
      : { subject: render(String(step.config.subject || template?.subject || "")), body: render(String(step.config.body || template?.body || "")), attachments: step.config.templateId === "send_catalog" ? await prepareFlowTemplateCatalog() : [] };
    if (!reply.subject || !reply.body) throw new Error("The email step did not produce a subject and body.");
    const subject = `[Flow test] ${reply.subject}`;
    const threadId = `flow-test:${id}`;
    const content = buildFlowEmail({ body: reply.body, config: { ...step.config, trackOpens: false, trackClicks: false, utmTracking: false },
      runId: id, stepId: step.id || id, flowId: id, appUrl: env.NEXT_PUBLIC_APP_URL, secret: env.supabaseSecretKey! });
    const recordId = randomUUID();
    const stored: Array<{ filename: string; contentType: string; size: number; path: string }> = [];
    for (const [index, attachment] of reply.attachments.entries()) {
      const path = `${userId}/${recordId}/${index}`;
      const upload = await admin.storage.from("mailbox-attachments").upload(path, attachment.content, { contentType: attachment.contentType, upsert: false });
      if (upload.error) throw new Error(`Could not store the test attachment: ${upload.error.message}`);
      uploadedPaths.push(path);
      stored.push({ filename: attachment.filename, contentType: attachment.contentType, size: attachment.content.length, path });
    }
    const sent = await sendMailboxEmail({ host: mailbox.smtpHost, port: mailbox.smtpPort, user: mailbox.smtpUsername, pass: mailbox.smtpPassword, from: mailbox.email },
      { to: row.recipient, subject, ...content, attachments: reply.attachments });
    smtpAccepted = true;
    const sentAt = new Date().toISOString();
    row.result.push({ step: action.step, subject, body: reply.body, messageId: sent.messageId || null, sentAt, attachments: stored.map(({ filename, size }) => ({ filename, size })) });
    // Checkpoint SMTP acceptance before recording Sent. Any later failure is
    // terminal and retains this evidence rather than resending the message.
    await admin.from(table).update({ result: row.result }).eq("id", id).eq("user_id", userId).throwOnError();
    await admin.from("mailbox_sent_messages").insert({ id: recordId, user_id: userId, mailbox_id: mailbox.id, message_id: sent.messageId || null,
      thread_key: threadId, from_email: mailbox.email, to_email: row.recipient, subject, body: reply.body, status: "sent", attachments: stored }).throwOnError();
    const nextAction = row.current_action + 1;
    const next = row.plan[nextAction];
    await admin.from(table).update({ current_action: nextAction, locked_at: null, next_run_at: next?.sendAt || null,
      status: next ? "waiting" : "completed", finished_at: next ? null : sentAt }).eq("id", id).eq("user_id", userId).throwOnError();
  } catch (cause) {
    if (!smtpAccepted && uploadedPaths.length) await admin.storage.from("mailbox-attachments").remove(uploadedPaths);
    const error = cause instanceof Error ? cause.message : "Test delivery failed.";
    await admin.from(table).update({ status: "failed", error, locked_at: null, next_run_at: null, finished_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId).throwOnError();
  }
  return loadFlowEmailDeliveryTest(id, userId);
}
