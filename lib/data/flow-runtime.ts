import "server-only";
import { requireWorkspaceMember } from "../auth.ts";
import { randomUUID } from "node:crypto";
import { uploadFlowAttachment } from "../attachment-upload.ts";
import { submitFlowEmail } from "../flow-smtp.ts";
import { buildFlowEmail } from "../flow-tracking.ts";
import { emailTemplates, renderFlowTemplate as renderTemplate } from "../flow-templates.ts";

import { allFlowActions, calculateWaitUntil, conditionMatches, triggerMatches, matchesFlowCustomer, matchesFlowScope, matchesProfileFilters, flowConversationPath, nextBusinessWindow, type FlowFacts, type TriggerEvent } from "../flow-engine.ts";
import { flowInputSchema, flowLeadListForSource, hasRetiredSalesConfig, retiredSalesMessage, type FlowInput, type FlowStep, type JsonConfig, type TriggerType } from "../flows.ts";
import { env } from "../env.ts";
import { sendMailboxEmail } from "../mailer.ts";
import { getUserEmailFooter, prepareUserEmail } from "./email-footers.ts";
import { removeStandardSignoff } from "../email-footer.ts";
import { normalizeMailboxRow } from "../mailbox-utils.ts";
import { evaluateSend } from "../outreach-policy.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { syncFlowMailboxMessages } from "./flow-mail-sync.ts";
import { isAutoReplySchemaMissing } from "../email-auto-reply.ts";
import { hasFlowReplyProvider, prepareFlowAiReply, prepareFlowTemplateCatalog } from "./flow-ai-reply.ts";

type RunRow = {
  id: string;
  flow_id: string;
  conversation_id: string;
  contact_id: string | null;
  company_id: string | null;
  current_step: number;
  status: "active" | "done" | "cancelled" | "failed";
  next_run_at: string | null;
  started_at: string;
  context: JsonConfig | null;
};

type FlowRow = { id: string; user_id: string; trigger_type: TriggerType; trigger_config: JsonConfig; status: string };
type ContactRow = { id: string; company_id: string; name: string | null; email: string; unsubscribed: boolean; verification_status: string; consent_source: string | null };

export { emailTemplates } from "../flow-templates.ts";

async function resolveCompanyId(contactId?: string | null, companyId?: string | null) {
  if (companyId) return companyId;
  if (!contactId) return null;
  const { data } = await createSupabaseAdmin().from("contacts").select("company_id").eq("id", contactId).maybeSingle().throwOnError();
  return data?.company_id ?? null;
}

export async function loadFlowFacts({ userId, contactId, companyId, messageKey, lookbackDays = 365, conversationId, since: sinceDate, runId, fallbackCategory }: { userId: string; contactId?: string | null; companyId?: string | null; messageKey?: string | null; lookbackDays?: number; conversationId?: string; since?: string; runId?: string; fallbackCategory?: string | null }): Promise<FlowFacts> {
  const admin = createSupabaseAdmin();
  const resolvedCompanyId = await resolveCompanyId(contactId, companyId);
  const since = new Date(Math.max(Date.now() - lookbackDays * 86_400_000, sinceDate ? Date.parse(sinceDate) : 0)).toISOString();
  let replyQuery = admin.from("emails").select("id", { count: "exact", head: true }).eq("contact_id", contactId || "00000000-0000-0000-0000-000000000000").eq("direction", "received").or(`owner_id.is.null,owner_id.eq.${userId}`).gt("created_at", since);
  if (conversationId && !/^(company:|shopify:)/.test(conversationId)) replyQuery = replyQuery.eq("thread_id", conversationId);
  const engagement = runId ? await admin.from("flow_run_logs").select("result").eq("run_id", runId).gte("created_at", since).in("result->>action", ["email_opened", "link_clicked"]).throwOnError() : { data: [] };
  const [companyResult, profileResult, replyResult, categoryResult] = await Promise.all([
    resolvedCompanyId ? admin.from("companies").select("segment,country,status").eq("id", resolvedCompanyId).maybeSingle().throwOnError() : Promise.resolve({ data: null }),
    resolvedCompanyId ? admin.from("company_profiles").select("fit_score").eq("company_id", resolvedCompanyId).maybeSingle().throwOnError() : Promise.resolve({ data: null }),
    contactId ? replyQuery.throwOnError() : Promise.resolve({ count: 0 }),
    messageKey ? admin.from("email_inbox_state").select("category").eq("user_id", userId).eq("message_key", messageKey).maybeSingle().throwOnError() : Promise.resolve({ data: null }),
  ]);
  return {
    customerReplied: Boolean(replyResult.count), openedEmail: Boolean(engagement.data?.some((log) => log.result?.action === "email_opened")), clickedLink: Boolean(engagement.data?.some((log) => log.result?.action === "link_clicked")),
    category: categoryResult.data ? categoryResult.data.category : fallbackCategory ?? null,
    segment: companyResult.data?.segment ?? null,
    country: companyResult.data?.country ?? null,
    companyStatus: companyResult.data?.status ?? null,
    pipelineStage: null,
    fitScore: profileResult.data?.fit_score == null ? null : Number(profileResult.data.fit_score),
  };
}

async function logRun(runId: string, stepId: string | null, result?: Record<string, unknown>, error?: string) {
  await createSupabaseAdmin().from("flow_run_logs").insert({ run_id: runId, result: result ? { ...result, stepId } : null, error: error ?? null }).throwOnError();
}

async function finishRun(runId: string, status: "done" | "cancelled" | "failed", error?: string) {
  await createSupabaseAdmin().from("flow_runs").update({ status, next_run_at: null, locked_at: null, finished_at: new Date().toISOString() }).eq("id", runId).throwOnError();
  if (error) await logRun(runId, null, undefined, error);
}

async function getContact(contactId: string | null) {
  if (!contactId) return null;
  const { data, error } = await createSupabaseAdmin().from("contacts").select("id,company_id,name,email,unsubscribed,verification_status,consent_source").eq("id", contactId).maybeSingle();
  if (error) throw error;
  return data as ContactRow | null;
}

async function getMailbox(flow: FlowRow, mailboxId: unknown) {
  const admin = createSupabaseAdmin();
  let query = admin.from("workspace_mailboxes").select("id,user_id,type,email,display_name,is_default,provider,notes,smtp_host,smtp_port,smtp_username,smtp_password,imap_host,imap_port,imap_username,imap_password,created_at,updated_at");
  if (typeof mailboxId === "string" && mailboxId !== "default" && mailboxId !== "owner") query = query.eq("id", mailboxId);
  else if (mailboxId === "owner") query = query.eq("user_id", flow.user_id).eq("type", "personal").eq("is_default", true);
  else query = query.eq("type", "workspace").eq("is_default", true);
  query = query.eq("is_active", true).or(`type.eq.workspace,user_id.eq.${flow.user_id}`);
  const { data } = await query.limit(1).maybeSingle();
  return normalizeMailboxRow(data);
}

// Real delivery tests resolve the sender with the same rules as live flows.
export async function getFlowTestMailbox(userId: string, mailboxId: unknown) {
  return getMailbox({ id: "", user_id: userId, trigger_type: "new_lead", trigger_config: {}, status: "draft" }, mailboxId);
}

export async function validateFlowResources(userId: string, input: FlowInput) {
  const admin = createSupabaseAdmin();
  for (const step of allFlowActions(input.steps)) {
    if (step.type === "internal_alert" && step.config.channel === "email") {
      const mailbox = await getMailbox({ id: "", user_id: userId, trigger_type: input.triggerType, trigger_config: input.triggerConfig, status: input.status }, step.config.mailboxId);
      if (!mailbox?.smtpHost || !mailbox.smtpUsername || !mailbox.smtpPassword) throw new Error("The selected sender mailbox needs complete SMTP settings before enabling email alerts.");
    }
    if (step.type === "send_email" || step.type === "ai_auto_reply") {
      const mailbox = await getMailbox({ id: "", user_id: userId, trigger_type: input.triggerType, trigger_config: input.triggerConfig, status: input.status }, step.config.mailboxId);
      if (!mailbox?.smtpHost || !mailbox.smtpUsername || !mailbox.smtpPassword) throw new Error("The selected sender mailbox needs complete SMTP settings.");
      if (step.type === "ai_auto_reply" && !hasFlowReplyProvider()) throw new Error("Configure an AI provider before enabling AI auto-reply.");
      if ((step.type === "ai_auto_reply" && step.config.attachCatalog) || (step.type === "send_email" && step.config.templateId === "send_catalog")) {
        const { count } = await admin.from("products").select("sku", { count: "exact", head: true }).eq("active", true).not("sku", "like", "SAMPLE-%").not("name", "ilike", "[sample]%").throwOnError();
        if (!count) throw new Error("Add active products before attaching an AI reply catalog.");
      }
    }
    const memberId = step.type === "create_task" && step.config.assigneeType === "user" ? step.config.assigneeId : step.type === "internal_alert" && step.config.userId !== "owner" ? step.config.userId : null;
    if (memberId) {
      const { data } = await admin.from("workspace_members").select("user_id,role").eq("user_id", memberId).not("activated_at", "is", null).maybeSingle().throwOnError();
      if (!data) throw new Error("Choose an active workspace member for tasks and alerts.");
      if (step.type === "create_task" && data.role === "viewer") throw new Error("Choose a workspace member who can manage tasks, rather than a read-only viewer.");
    }
  }
}

async function executeEmail(run: RunRow, flow: FlowRow, step: FlowStep, facts: FlowFacts) {
  if (!matchesProfileFilters(flow.trigger_config, facts) || (step.config.filters && !conditionMatches(step.config.filters as JsonConfig, facts))) {
    await logRun(run.id, step.id, { action: "email_skipped", reason: "Profile or message filters no longer match." });
    return;
  }
  if (step.type === "send_email" && step.config.stopOnReply !== false && facts.customerReplied) {
    await logRun(run.id, step.id, { action: "cancelled", reason: "Customer replied" });
    await finishRun(run.id, "cancelled");
    return "terminal" as const;
  }
  const contact = await getContact(run.contact_id);
  if (!contact) throw new Error("Email step requires a CRM contact.");
  if (!matchesFlowCustomer(flow.trigger_config ?? {}, contact.id) || !matchesFlowScope(flow.trigger_config ?? {}, contact.company_id, contact.id)) {
    await logRun(run.id, step.id, { action: "cancelled", reason: "Customer is no longer selected for this flow." });
    await finishRun(run.id, "cancelled");
    return "terminal" as const;
  }
  const admin = createSupabaseAdmin();
  const automatedMailbox = await getMailbox(flow, step.config.mailboxId);
  if (Number(step.config.smartSendingHours) > 0) {
    const since = new Date(Date.now() - Number(step.config.smartSendingHours) * 3_600_000).toISOString();
    const { count } = await admin.from("mailbox_sent_messages").select("id", { count: "exact", head: true }).eq("user_id", flow.user_id).eq("to_email", contact.email.toLowerCase()).gte("sent_at", since).throwOnError();
    if (count) { await logRun(run.id, step.id, { action: "email_skipped", reason: "Smart Sending: this customer was emailed recently." }); return; }
  }
  const { data: conversationAutomation, error: automationError } = await admin.from("email_auto_replies").select("id").eq("recipient", contact.email.toLowerCase())
    .eq("mailbox_id", automatedMailbox?.id || "00000000-0000-0000-0000-000000000000")
    .eq("thread_key", String(run.context?.emailThreadId || run.conversation_id)).eq("enabled", true).limit(1).maybeSingle();
  if (automationError && !isAutoReplySchemaMissing(automationError)) throw automationError;
  if (conversationAutomation) {
    await logRun(run.id, step.id, { action: "cancelled", reason: "Conversation AI auto-reply is handling this customer." });
    await finishRun(run.id, "cancelled");
    return "terminal" as const;
  }
  if (step.config.sendWindow === "business_hours") {
    const resumeAt = nextBusinessWindow();
    if (resumeAt) {
      await Promise.all([
        admin.from("flow_runs").update({ next_run_at: resumeAt.toISOString(), locked_at: null }).eq("id", run.id).throwOnError(),
        logRun(run.id, step.id, { action: "waiting_for_send_window", nextRunAt: resumeAt.toISOString() }),
      ]);
      return "waiting" as const;
    }
  }
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const { count } = await admin.from("mailbox_sent_messages").select("id", { count: "exact", head: true }).eq("user_id", flow.user_id).gte("sent_at", today.toISOString()).throwOnError();
  const { count: suppressed } = await admin.from("suppression").select("email", { count: "exact", head: true }).eq("email", contact.email).throwOnError();
  // Form inquiries and received customer emails can be answered without a
  // third-party address check. Never relabel those contacts as verified.
  const formInquiry = ["shopify_b2b_form", "shopify_b2b_form_opt_in", "meta_lead_ads"].includes(contact.consent_source ?? "");
  const { count: inboundCount } = !formInquiry && contact.verification_status !== "valid"
    ? await admin.from("emails").select("id", { count: "exact", head: true }).eq("contact_id", contact.id).eq("direction", "received").or(`owner_id.is.null,owner_id.eq.${flow.user_id}`).throwOnError()
    : { count: 0 };
  const inquiryResponse = ["unverified", "unknown"].includes(contact.verification_status) && (formInquiry || Boolean(inboundCount));
  const decision = evaluateSend({ email: contact.email, verified: contact.verification_status === "valid", inquiryResponse, unsubscribed: contact.unsubscribed, suppressed: Boolean(suppressed), sentToday: count ?? 0, dailyLimit: env.DAILY_SEND_LIMIT, bounceRate: 0, bouncePausePercent: env.BOUNCE_PAUSE_PERCENT, dryRun: env.dryRun });
  if (!decision.allowed) throw new Error(decision.reason);
  const template = emailTemplates[String(step.config.templateId)];
  if (step.type === "send_email" && !template) throw new Error("The selected email template is unavailable.");
  let subject = step.type === "ai_auto_reply" ? "AI personalized reply" : renderTemplate(String(step.config.subject || template!.subject), contact);
  let body = step.type === "ai_auto_reply" ? "" : renderTemplate(String(step.config.body || template!.body), contact);
  if (decision.mode === "dry-run") {
    await logRun(run.id, step.id, { action: "email_dry_run", to: contact.email, subject, aiGenerated: step.type === "ai_auto_reply", catalogRequested: step.config.attachCatalog === true, reason: decision.reason });
    return "continue" as const;
  }
  const mailbox = await getMailbox(flow, step.config.mailboxId);
  if (!mailbox) throw new Error("The selected sender mailbox is unavailable.");
  const aiReply = step.type === "ai_auto_reply" ? await prepareFlowAiReply({ userId: flow.user_id, contactId: contact.id, companyId: contact.company_id, conversationId: String(run.context?.emailThreadId || run.conversation_id), config: step.config }) : null;
  let attachments = aiReply?.attachments ?? (step.config.templateId === "send_catalog" ? await prepareFlowTemplateCatalog(flow.user_id) : []);
  if (aiReply) { subject = aiReply.subject; body = aiReply.body; }
  const conversationId = String(run.context?.emailThreadId || run.conversation_id);
  const { data: previous } = step.config.replyInThread !== false
    ? await admin.from("emails").select("message_id").eq("contact_id", contact.id).eq("thread_id", conversationId).or(`owner_id.is.null,owner_id.eq.${flow.user_id}`).not("message_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle().throwOnError()
    : { data: null };
  const inReplyTo = aiReply?.inReplyTo || previous?.message_id;
  const threadId = step.config.replyInThread === false ? `flow:${randomUUID()}` : aiReply?.threadId || conversationId;
  const replyHeaders = inReplyTo ? { inReplyTo, references: [inReplyTo] } : {};
  const footer = await getUserEmailFooter(flow.user_id);
  if (footer?.html) body = removeStandardSignoff(body);
  const content = await prepareUserEmail(flow.user_id, { ...buildFlowEmail({ body, config: step.config, runId: run.id, stepId: step.id, flowId: flow.id, appUrl: env.NEXT_PUBLIC_APP_URL, secret: env.supabaseSecretKey! }), attachments }, false, footer);
  attachments = content.attachments as typeof attachments;
  body = content.text;
  const sentRecordId = randomUUID();
  const storedAttachments: Array<{ filename: string; contentType: string; size: number; path: string; cid?: string }> = [];
  const uploadPaths: string[] = [];
  let sent;
  try {
    for (const [index, attachment] of attachments.entries()) {
      const path = `${flow.user_id}/${sentRecordId}/${index}`;
      uploadPaths.push(path);
      await uploadFlowAttachment((options) => admin.storage.from("mailbox-attachments").upload(path, attachment.content, { contentType: attachment.contentType, ...options }));
      storedAttachments.push({ filename: attachment.filename, contentType: attachment.contentType, size: attachment.content.length, path, ...( "cid" in attachment ? { cid: attachment.cid as string } : {}) });
    }
    sent = await submitFlowEmail(() => sendMailboxEmail({ host: mailbox.smtpHost, port: mailbox.smtpPort, user: mailbox.smtpUsername, pass: mailbox.smtpPassword, from: mailbox.email }, { to: contact.email, subject, ...content, ...replyHeaders, attachments }));
  } catch (error) {
    if (uploadPaths.length) await admin.storage.from("mailbox-attachments").remove(uploadPaths);
    throw error;
  }
  run.context = { ...run.context, emailThreadId: threadId, replySince: new Date().toISOString() };
  await Promise.all([
    admin.from("flow_runs").update({ context: run.context }).eq("id", run.id).throwOnError(),
    admin.from("mailbox_sent_messages").insert({ id: sentRecordId, user_id: flow.user_id, mailbox_id: mailbox.id, message_id: sent.messageId || null, thread_key: threadId, in_reply_to: inReplyTo || null, reference_ids: inReplyTo ? [inReplyTo] : [], from_email: mailbox.email, to_email: contact.email, subject, body, body_html: content.html || null, status: "sent", attachments: storedAttachments }).throwOnError(),
    admin.from("emails").insert({ contact_id: contact.id, direction: "sent", subject, body, thread_id: threadId, owner_id: flow.user_id, message_id: sent.messageId || null, status: "sent", step: run.current_step + 1, sent_at: new Date().toISOString() }).throwOnError(),
    logRun(run.id, step.id, { action: "email_sent", to: contact.email, subject, messageId: sent.messageId || null, aiGenerated: Boolean(aiReply), catalogAttached: Boolean(attachments.length) }),
  ]);
  return "continue" as const;
}

async function executeAction(run: RunRow, flow: FlowRow, step: FlowStep, facts: FlowFacts) {
  const admin = createSupabaseAdmin();
  if (step.type === "send_email" || step.type === "ai_auto_reply") return executeEmail(run, flow, step, facts);
  if (step.type === "create_task") {
    const { data: pipeline } = run.company_id && step.config.assigneeType !== "user" ? await admin.from("pipeline").select("owner_id").eq("company_id", run.company_id).maybeSingle().throwOnError() : { data: null };
    await admin.from("crm_tasks").insert({ flow_run_id: run.id, company_id: run.company_id, contact_id: run.contact_id, assigned_to: step.config.assigneeType === "user" ? step.config.assigneeId : pipeline?.owner_id || flow.user_id, follows_company_owner: step.config.assigneeType !== "user", title: step.config.title, notes: step.config.notes || null, priority: step.config.priority || "normal", due_at: new Date(Date.now() + Number(step.config.dueInDays || 0) * 86_400_000).toISOString() }).throwOnError();
    await logRun(run.id, step.id, { action: "task_created", title: step.config.title });
  } else if (step.type === "change_category") {
    const messageKey = String(run.context?.messageKey || run.conversation_id);
    const { data: previous } = await admin.from("email_inbox_state").select("category").eq("user_id", flow.user_id).eq("message_key", messageKey).maybeSingle().throwOnError();
    await admin.from("email_inbox_state").upsert({ user_id: flow.user_id, message_key: messageKey, category: step.config.category, updated_at: new Date().toISOString() }, { onConflict: "user_id,message_key", ignoreDuplicates: false }).throwOnError();
    await logRun(run.id, step.id, { action: "category_changed", category: step.config.category, reason: step.config.reason || null });
    if (previous?.category !== step.config.category) await enrollMatchingFlows({ type: "category_changed", conversationId: run.conversation_id, messageKey,
      contactId: run.contact_id, companyId: run.company_id, category: String(step.config.category), eventKey: `category:${run.id}:${step.id}` });
  } else if (step.type === "update_company") {
    if (!run.company_id) throw new Error("Update company requires a company-backed flow run.");
    const writes = [];
    if (step.config.companyStatus || step.config.segment) writes.push(admin.from("companies").update({
      ...(step.config.companyStatus ? { status: step.config.companyStatus } : {}),
      ...(step.config.segment ? { segment: step.config.segment } : {}),
    }).eq("id", run.company_id));
    const results = await Promise.all(writes);
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
    await admin.from("events").insert({ company_id: run.company_id, actor_id: flow.user_id, type: "flow_company_updated", data: { summary: step.config.note || "Company fields updated by automation.", flow_id: flow.id } }).throwOnError();
    await logRun(run.id, step.id, { action: "company_updated", companyStatus: step.config.companyStatus || null, segment: step.config.segment || null });
  } else if (step.type === "internal_alert") {
    const { data: pipeline } = run.company_id ? await admin.from("pipeline").select("owner_id").eq("company_id", run.company_id).maybeSingle().throwOnError() : { data: null };
    const userId = String(step.config.userId === "owner" ? pipeline?.owner_id || flow.user_id : step.config.userId);
    await admin.from("internal_notifications").insert({ flow_run_id: run.id, user_id: userId, channel: step.config.channel || "in_app", message: step.config.message, conversation_id: run.conversation_id, include_thread_link: step.config.includeThreadLink !== false }).throwOnError();
    let delivery = "in_app";
    if (step.config.channel === "email") {
      if (env.dryRun) delivery = "email_dry_run";
      else {
        const [{ data: recipient }, mailbox] = await Promise.all([admin.auth.admin.getUserById(userId), getMailbox(flow, step.config.mailboxId)]);
        if (!recipient.user?.email || !mailbox) throw new Error("The alert recipient or sender mailbox is unavailable.");
        await sendMailboxEmail({ host: mailbox.smtpHost, port: mailbox.smtpPort, user: mailbox.smtpUsername, pass: mailbox.smtpPassword, from: mailbox.email }, { to: recipient.user.email, subject: `Filazoo CRM alert · ${flow.id.slice(0, 8)}`, text: `${step.config.message}${step.config.includeThreadLink !== false ? `\n\n${env.NEXT_PUBLIC_APP_URL}${flowConversationPath(run.conversation_id)}` : ""}` });
        delivery = "email_sent";
      }
    }
    await logRun(run.id, step.id, { action: "alert_created", delivery });
  }
  return "continue" as const;
}

export async function processFlowRun(runId: string) {
  const admin = createSupabaseAdmin();
  const { data: runData, error: runError } = await admin.from("flow_runs").select("id,flow_id,conversation_id,contact_id,company_id,current_step,status,next_run_at,started_at,context").eq("id", runId).maybeSingle();
  if (runError || !runData) throw new Error(runError?.message || "Flow run not found.");
  const run = runData as RunRow;
  if (run.status !== "active" || (run.next_run_at && Date.parse(run.next_run_at) > Date.now())) return { status: run.status, processed: 0 };
  const [{ data: flowData, error: flowError }, { data: stepRows, error: stepError }] = await Promise.all([
    admin.from("flows").select("id,user_id,trigger_type,trigger_config,status").eq("id", run.flow_id).maybeSingle(),
    admin.from("flow_steps").select("id,flow_id,position,type,config").eq("flow_id", run.flow_id).order("position"),
  ]);
  if (flowError || !flowData || stepError) throw new Error(flowError?.message || stepError?.message || "Flow definition is unavailable.");
  const flow = flowData as FlowRow;
  if (flow.status === "paused") return { status: "paused", processed: 0 };
  if (flow.status !== "live") { await finishRun(run.id, "cancelled"); return { status: "cancelled", processed: 0 }; }
  const { data: claimed } = await admin.from("flow_runs").update({ locked_at: new Date().toISOString() }).eq("id", run.id).eq("status", "active").is("locked_at", null).select("id").maybeSingle().throwOnError();
  if (!claimed) return { status: "locked", processed: 0 };
  let index = run.current_step;
  let processed = 0;
  try {
    if (flow.trigger_config.flowScope) {
      const contact = run.contact_id ? await getContact(run.contact_id) : null;
      const currentCompanyId = run.contact_id ? contact?.company_id : run.company_id;
      if (!matchesFlowScope(flow.trigger_config, currentCompanyId, contact?.id)) {
        await logRun(run.id, null, { action: "cancelled", reason: "Contact no longer matches this email or company flow." });
        await finishRun(run.id, "cancelled");
        return { status: "cancelled", processed: 0 };
      }
    }
    const snapshot = typeof run.context?.definition === "string" ? JSON.parse(run.context.definition) as FlowStep[] : stepRows;
    const savedSteps = (snapshot ?? []) as FlowStep[];
    if (hasRetiredSalesConfig({ triggerType: flow.trigger_type, triggerConfig: flow.trigger_config, steps: savedSteps })) {
      await logRun(run.id, null, { action: "cancelled", reason: retiredSalesMessage });
      await finishRun(run.id, "cancelled");
      return { status: "cancelled", processed: 0 };
    }
    const validated = flowInputSchema.parse({ name: "Runtime validation", triggerType: flow.trigger_type, triggerConfig: flow.trigger_config, status: "live", steps: savedSteps });
    const steps = savedSteps.map((step, index) => ({ ...step, config: validated.steps[index].config }));
    while (index < steps.length) {
      const step = steps[index]!;
      const facts = await loadFlowFacts({ userId: flow.user_id, contactId: run.contact_id, companyId: run.company_id, messageKey: String(run.context?.messageKey || "") || run.conversation_id, lookbackDays: Number(step.config.lookbackDays || 365), conversationId: String(run.context?.emailThreadId || run.conversation_id), since: String(run.context?.replySince || run.started_at), runId: run.id, fallbackCategory: typeof run.context?.category === "string" ? run.context.category : null });
      if (step.type === "split") {
        const paths = Array.isArray(step.config.paths) ? step.config.paths : [];
        const selected = paths.find((path) => path && typeof path === "object" && !Array.isArray(path) && path.condition && typeof path.condition === "object" && !Array.isArray(path.condition) && conditionMatches(path.condition as JsonConfig, facts))
          ?? paths.find((path) => path && typeof path === "object" && !Array.isArray(path) && path.condition === null);
        const selectedPath = selected && typeof selected === "object" && !Array.isArray(selected) ? selected : null;
        const nested = selectedPath && Array.isArray(selectedPath.steps) ? selectedPath.steps as unknown as FlowStep[] : [];
        const expanded = [...steps.slice(0, index), ...nested, ...steps.slice(index + 1)];
        run.context = { ...(run.context ?? {}), definition: JSON.stringify(expanded) };
        await Promise.all([
          admin.from("flow_runs").update({ context: run.context, current_step: index, next_run_at: null }).eq("id", run.id).throwOnError(),
          logRun(run.id, step.id, { action: "split_evaluated", pathId: selectedPath?.id || null, pathName: selectedPath?.name || "Everyone else" }),
        ]);
        steps.splice(0, steps.length, ...expanded);
        processed += 1;
        continue;
      }
      if (step.type === "wait") {
        // The first delay starts at intake/receipt, including scanner recovery.
        const firstEventAt = new Date(String(run.context?.replySince || run.started_at));
        const waitFrom = index === 0 && Number.isFinite(firstEventAt.getTime())
          ? new Date(Math.min(firstEventAt.getTime(), Date.now())) : new Date();
        const nextRunAt = calculateWaitUntil(step.config, waitFrom);
        await Promise.all([
          admin.from("flow_runs").update({ current_step: index + 1, next_run_at: nextRunAt.toISOString(), locked_at: null }).eq("id", run.id).throwOnError(),
          logRun(run.id, step.id, { action: "waiting", nextRunAt: nextRunAt.toISOString() }),
        ]);
        return { status: "waiting", processed: processed + 1, nextRunAt: nextRunAt.toISOString() };
      }
      if (step.type === "if_condition") {
        const matched = conditionMatches(step.config, facts);
        const action = String(matched ? step.config.action || "continue" : step.config.unmatchedAction || "continue");
        await logRun(run.id, step.id, { action: "condition_evaluated", matched, branch: action });
        processed += 1;
        if (action === "stop_flow") { await finishRun(run.id, "done"); return { status: "done", processed }; }
        index += action === "skip_next" ? 2 : 1;
        await admin.from("flow_runs").update({ current_step: index, next_run_at: null }).eq("id", run.id).throwOnError();
        continue;
      }
      if (step.type === "stop") {
        await logRun(run.id, step.id, { action: "stopped", reason: step.config.reason || null });
        await finishRun(run.id, step.config.outcome === "cancelled" ? "cancelled" : "done");
        return { status: step.config.outcome === "cancelled" ? "cancelled" : "done", processed: processed + 1 };
      }
      run.current_step = index;
      const result = await executeAction(run, flow, step, facts);
      processed += 1;
      if (result === "terminal") return { status: "cancelled", processed };
      if (result === "waiting") return { status: "waiting", processed };
      index += 1;
      await admin.from("flow_runs").update({ current_step: index, next_run_at: null }).eq("id", run.id).throwOnError();
    }
    await finishRun(run.id, "done");
    return { status: "done", processed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Flow execution failed.";
    await finishRun(run.id, "failed", message);
    return { status: "failed", processed, error: message };
  }
}

export async function enrollMatchingFlows(event: TriggerEvent) {
  const admin = createSupabaseAdmin();
  let flowQuery = admin.from("flows").select("id,user_id,trigger_type,trigger_config,status").eq("status", "live").eq("trigger_type", event.type);
  if (event.type === "new_lead" || event.type === "lead_added_to_list") {
    if (!event.contactId) throw new Error("New-lead enrollment requires a CRM contact.");
    const { data: contact } = await admin.from("contacts").select("id,company_id,created_at,consent_source").eq("id", event.contactId).maybeSingle().throwOnError();
    if (!contact) throw new Error("New-lead contact was not found.");
    // Direct intake and the recovery scanner must share the same activation
    // boundary and event key, including when an existing contact submits again.
    flowQuery = flowQuery.lte("lead_enrollment_started_at", contact.created_at);
    const listId = event.type === "lead_added_to_list" ? flowLeadListForSource(contact.consent_source) : null;
    if (event.type === "lead_added_to_list" && (!listId || event.listId !== listId)) return [];
    event = { ...event, companyId: contact.company_id, conversationId: `company:${contact.company_id}:lead:${contact.id}`,
      occurredAt: contact.created_at, eventKey: listId ? `list:${listId}:${contact.id}` : `new_lead:${contact.id}` };
  }
  if (event.flowId) flowQuery = flowQuery.eq("id", event.flowId);
  if (event.type === "email_received") {
    if (!event.occurredAt) throw new Error("Email enrollment requires the message receipt time.");
    flowQuery = flowQuery.lte("email_enrollment_started_at", event.occurredAt);
  }
  const { data: flowRows, error } = await flowQuery;
  if (error) throw new Error(`Unable to load matching flows: ${error.message}`);
  const companyId = await resolveCompanyId(event.contactId, event.companyId);
  event = { ...event, companyId };
  const eventKey = event.eventKey || `${event.type}:${event.conversationId}:${randomUUID()}`;
  const results: Array<{ flowId: string; runId?: string; enrolled: boolean; reason?: string }> = [];
  for (const row of (flowRows ?? []) as FlowRow[]) {
    let contactId = event.contactId;
    // Company changes are emitted with a representative contact. An email-only
    // flow must instead enroll its own saved contact at that same company.
    if (["company_segment_changed", "pipeline_stage_changed"].includes(event.type) && row.trigger_config?.flowScope === "email" && row.trigger_config.scopeCompanyId === companyId) {
      const contact = await getContact(String(row.trigger_config.scopeContactId || ""));
      contactId = contact && contact.company_id === companyId ? contact.id : null;
    }
    const scopedEvent = { ...event, contactId };
    const facts = await loadFlowFacts({ userId: row.user_id, contactId, companyId, messageKey: event.messageKey });
    if (!triggerMatches(row.trigger_type, row.trigger_config ?? {}, scopedEvent, facts)) { results.push({ flowId: row.id, enrolled: false, reason: "Trigger filters did not match" }); continue; }
    const reentryMode = String(row.trigger_config?.reentryMode || "every_event");
    if (reentryMode !== "every_event") {
      let previousQuery = admin.from("flow_runs").select("id").eq("flow_id", row.id);
      if (contactId) previousQuery = previousQuery.eq("contact_id", contactId);
      else if (companyId) previousQuery = previousQuery.eq("company_id", companyId);
      else previousQuery = previousQuery.eq("conversation_id", event.conversationId);
      if (reentryMode === "after_period") {
        const amount = Number(row.trigger_config?.reentryAfterAmount || 1);
        const milliseconds = amount * (row.trigger_config?.reentryAfterUnit === "hours" ? 3_600_000 : 86_400_000);
        previousQuery = previousQuery.gt("started_at", new Date(Date.now() - milliseconds).toISOString());
      }
      const { data: previous } = await previousQuery.limit(1).maybeSingle().throwOnError();
      if (previous) { results.push({ flowId: row.id, enrolled: false, reason: reentryMode === "no_reentry" ? "Customer already entered this flow" : "Customer is still in the re-entry waiting period" }); continue; }
    }
    const { data: definition } = await admin.from("flow_steps").select("id,position,type,config").eq("flow_id", row.id).order("position").throwOnError();
    flowInputSchema.parse({ name: "Enrollment validation", triggerType: row.trigger_type, triggerConfig: row.trigger_config, status: "live", steps: definition });
    const { data: run, error: insertError } = await admin.from("flow_runs").insert({ flow_id: row.id, conversation_id: event.conversationId, event_key: eventKey, contact_id: contactId ?? null, company_id: companyId, current_step: 0, status: "active", next_run_at: new Date().toISOString(), context: { messageKey: event.messageKey ?? null, category: event.category ?? null, listId: event.listId ?? null, segment: event.segment ?? null, stage: event.stage ?? null, replySince: event.occurredAt ?? new Date().toISOString(), definition: JSON.stringify(definition) } }).select("id").single();
    if (insertError) {
      if (insertError.code === "23505") results.push({ flowId: row.id, enrolled: false, reason: "Conversation already has an active run" });
      else results.push({ flowId: row.id, enrolled: false, reason: insertError.message });
      continue;
    }
    await logRun(run.id, null, { action: "enrolled", trigger: event.type });
    const execution = await processFlowRun(run.id);
    results.push({ flowId: row.id, runId: run.id, enrolled: true, reason: execution.status });
  }
  return results;
}

// Intake succeeds even if automation fails; the scanner can recover missed
// enrollment using the same durable contact ID without duplicate deliveries.
export async function enrollNewLeadFlows(contactId: string) {
  try {
    const results = await enrollMatchingFlows({ type: "new_lead", contactId, conversationId: "" });
    const { data: contact } = await createSupabaseAdmin().from("contacts").select("consent_source").eq("id", contactId).maybeSingle().throwOnError();
    const listId = flowLeadListForSource(contact?.consent_source);
    if (listId) results.push(...await enrollMatchingFlows({ type: "lead_added_to_list", contactId, listId, conversationId: "" }));
    return results;
  } catch (error) {
    console.error("Lead saved, but new-lead flow enrollment failed:", error);
    return [];
  }
}

export async function scanTimeBasedFlowTriggers(flowId?: string) {
  const admin = createSupabaseAdmin();
  let query = admin.from("flows").select("id,user_id,trigger_type,trigger_config,status,lead_enrollment_started_at,email_enrollment_started_at").eq("status", "live").in("trigger_type", ["new_lead", "lead_added_to_list", "email_received", "no_reply"]);
  if (flowId) query = query.eq("id", flowId);
  const { data: flows, error } = await query;
  if (error) throw new Error(`Unable to scan flow triggers: ${error.message}`);
  let enrolled = 0;
  for (const flow of (flows ?? []) as (FlowRow & { lead_enrollment_started_at: string | null; email_enrollment_started_at: string | null })[]) {
    if (flow.trigger_type === "new_lead" || flow.trigger_type === "lead_added_to_list") {
      // The activation timestamp excludes existing leads and leads added while paused.
      if (!flow.lead_enrollment_started_at) continue;
      for (let offset = 0; ; offset += 500) {
        const { data: contacts } = await admin.from("contacts").select("id,company_id,created_at,consent_source")
          .gte("created_at", flow.lead_enrollment_started_at).order("created_at").order("id").range(offset, offset + 499).throwOnError();
        const eventKey = (id: string) => flow.trigger_type === "new_lead" ? `new_lead:${id}` : `list:${flow.trigger_config.listId}:${id}`;
        const eventKeys = (contacts ?? []).map((contact) => eventKey(contact.id));
        const { data: existingRuns } = eventKeys.length ? await admin.from("flow_runs").select("event_key")
          .eq("flow_id", flow.id).in("event_key", eventKeys).throwOnError() : { data: [] };
        const enrolledKeys = new Set((existingRuns ?? []).map((run) => run.event_key));
        for (const contact of contacts ?? []) {
          if (enrolledKeys.has(eventKey(contact.id))) continue;
          if (flow.trigger_type === "lead_added_to_list" && flowLeadListForSource(contact.consent_source) !== flow.trigger_config.listId) continue;
          const result = await enrollMatchingFlows({ type: flow.trigger_type, listId: flow.trigger_type === "lead_added_to_list" ? String(flow.trigger_config.listId) : undefined, flowId: flow.id, contactId: contact.id, companyId: contact.company_id,
            conversationId: `company:${contact.company_id}:lead:${contact.id}`, occurredAt: contact.created_at, eventKey: `new_lead:${contact.id}` });
          enrolled += result.filter((item) => item.enrolled).length;
        }
        if (!contacts || contacts.length < 500) break;
      }
    } else if (flow.trigger_type === "email_received") {
      if (!flow.email_enrollment_started_at) continue;
      for (let offset = 0; ; offset += 500) {
        const { data: inbound } = await admin.from("emails").select("id,contact_id,thread_id,message_id,created_at,contacts(company_id)").eq("direction", "received").or(`owner_id.is.null,owner_id.eq.${flow.user_id}`).gte("created_at", flow.email_enrollment_started_at).order("created_at").order("id").range(offset, offset + 499).throwOnError();
        const eventKeys = (inbound ?? []).map((email) => `email_received:${email.id}`);
        const { data: existingRuns } = eventKeys.length ? await admin.from("flow_runs").select("event_key").eq("flow_id", flow.id).in("event_key", eventKeys).throwOnError() : { data: [] };
        const enrolledKeys = new Set((existingRuns ?? []).map((run) => run.event_key));
        for (const email of inbound ?? []) {
          if (enrolledKeys.has(`email_received:${email.id}`)) continue;
          const relation = email.contacts as unknown as { company_id?: string } | Array<{ company_id?: string }> | null;
          const contactCompanyId = Array.isArray(relation) ? relation[0]?.company_id : relation?.company_id;
          const result = await enrollMatchingFlows({ type: "email_received", flowId: flow.id, conversationId: email.thread_id || email.message_id || `email:${email.id}`, messageKey: email.message_id ? `imap-${email.message_id}` : undefined, occurredAt: email.created_at, eventKey: `email_received:${email.id}`, contactId: email.contact_id, companyId: contactCompanyId ?? null });
          enrolled += result.filter((item) => item.enrolled).length;
        }
        if (!inbound || inbound.length < 500) break;
      }
    } else {
      const ownRunIds: string[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data: runs } = await admin.from("flow_runs").select("id").eq("flow_id", flow.id).order("id").range(offset, offset + 499).throwOnError();
        ownRunIds.push(...(runs ?? []).map(run => run.id));
        if (!runs || runs.length < 500) break;
      }
      const seen = new Set<string>();
      for (let offset = 0; ; offset += 500) {
        const { data: outbound } = await admin.from("emails").select("id,contact_id,thread_id,message_id,sent_at,created_at,contacts(company_id)").eq("direction", "sent").eq("status", "sent").or(`owner_id.is.null,owner_id.eq.${flow.user_id}`).order("sent_at", { ascending: false }).order("id").range(offset, offset + 499).throwOnError();
        const automatedIds = new Set<string>();
        const messageIds = (outbound ?? []).flatMap(email => email.message_id ? [email.message_id] : []);
        for (let index = 0; messageIds.length && index < ownRunIds.length; index += 500) {
          const { data: logs } = await admin.from("flow_run_logs").select("result").in("run_id", ownRunIds.slice(index, index + 500)).eq("result->>action", "email_sent").in("result->>messageId", messageIds).throwOnError();
          for (const log of logs ?? []) if (typeof log.result?.messageId === "string") automatedIds.add(log.result.messageId);
        }
        for (const email of outbound ?? []) {
          const conversationId = email.thread_id || email.message_id || `email:${email.id}`;
          const key = `${email.contact_id}:${conversationId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const sentAt = email.sent_at || email.created_at;
          if (calculateWaitUntil(flow.trigger_config, new Date(sentAt)).getTime() > Date.now()) continue;
          if (email.message_id && automatedIds.has(email.message_id)) continue;
          let repliesQuery = admin.from("emails").select("id", { count: "exact", head: true }).eq("contact_id", email.contact_id).eq("direction", "received").or(`owner_id.is.null,owner_id.eq.${flow.user_id}`).gt("created_at", sentAt);
          if (email.thread_id) repliesQuery = repliesQuery.eq("thread_id", email.thread_id);
          const { count: replies } = await repliesQuery.throwOnError();
          if (replies) continue;
          const relation = email.contacts as unknown as { company_id?: string } | Array<{ company_id?: string }> | null;
          const contactCompanyId = Array.isArray(relation) ? relation[0]?.company_id : relation?.company_id;
          const result = await enrollMatchingFlows({ type: "no_reply", flowId: flow.id, conversationId, occurredAt: sentAt, eventKey: `no_reply:${email.id}`, contactId: email.contact_id, companyId: contactCompanyId ?? null });
          enrolled += result.filter((item) => item.enrolled).length;
        }
        if (!outbound || outbound.length < 500) break;
      }
    }
  }
  return enrolled;
}

export async function processDueFlowRuns(limit = 50, options: { syncMailbox?: boolean } = {}) {
  const admin = createSupabaseAdmin();
  const { data: interrupted } = await admin.from("flow_runs").select("id").eq("status", "active").lt("locked_at", new Date(Date.now() - 15 * 60000).toISOString()).throwOnError();
  for (const run of interrupted ?? []) await finishRun(run.id, "failed", "Execution was interrupted. Review the last action before restarting to avoid duplicate delivery.");
  const { data, error } = await admin.from("flow_runs").select("id").eq("status", "active").is("locked_at", null).or(`next_run_at.is.null,next_run_at.lte.${new Date().toISOString()}`).order("next_run_at").limit(limit);
  if (error) throw new Error(`Unable to load due flow runs: ${error.message}`);
  const results = [];
  for (const run of data ?? []) {
    try { results.push({ runId: run.id, ...(await processFlowRun(run.id)) }); }
    catch (error) { results.push({ runId: run.id, status: "error", error: error instanceof Error ? error.message : "Unable to process this run." }); }
  }
  // A separate minute tick resumes waits without waiting for slow IMAP logins.
  if (options.syncMailbox !== false) await syncFlowMailboxMessages();
  await scanTimeBasedFlowTriggers();
  return results;
}

export async function listFlowRunInsights(flowId: string) {
  await requireWorkspaceMember();
  const admin = createSupabaseAdmin();
  const { data: flow, error: flowError } = await admin.from("flows").select("id").eq("id", flowId).maybeSingle();
  if (flowError) throw new Error(`Unable to load flow: ${flowError.message}`);
  if (!flow) throw new Error("Flow not found.");
  const { data, error } = await admin.from("flow_runs").select("id,status,current_step,started_at,finished_at,next_run_at,conversation_id,flow_run_logs(id,result,error,created_at)").eq("flow_id", flowId).order("started_at", { ascending: false }).limit(25);
  if (error) throw new Error(`Unable to load flow insights: ${error.message}`);
  return data ?? [];
}
