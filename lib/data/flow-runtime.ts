import "server-only";
import { randomUUID } from "node:crypto";
import { buildFlowEmail } from "../flow-tracking.ts";

import { calculateWaitUntil, conditionMatches, triggerMatches, flowConversationPath, type FlowFacts, type TriggerEvent } from "../flow-engine.ts";
import { flowInputSchema, type FlowInput, type FlowStep, type JsonConfig, type TriggerType } from "../flows.ts";
import { env } from "../env.ts";
import { sendMailboxEmail } from "../mailer.ts";
import { normalizeMailboxRow } from "../mailbox-utils.ts";
import { evaluateSend } from "../outreach-policy.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { syncFlowMailboxMessages } from "./flow-mail-sync.ts";
import { hasFlowReplyProvider, prepareFlowAiReply } from "./flow-ai-reply.ts";

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
type ContactRow = { id: string; company_id: string; name: string | null; email: string; unsubscribed: boolean; verification_status: string };

const emailTemplates: Record<string, { subject: string; body: string }> = {
  helpful_reminder: { subject: "Just checking in", body: "Hi {{first_name}},\n\nI wanted to follow up and see whether I can help with your filament requirements.\n\nBest,\nFilazoo" },
  send_catalog: { subject: "Filazoo product catalog", body: "Hi {{first_name}},\n\nHere is the product information we discussed. Reply with the materials and volumes you need and we will prepare pricing.\n\nBest,\nFilazoo" },
  quote_follow_up: { subject: "Following up on your quote", body: "Hi {{first_name}},\n\nDo you have any questions about the quote? I am happy to adjust quantities, materials, or delivery options.\n\nBest,\nFilazoo" },
  welcome_intro: { subject: "Welcome to Filazoo", body: "Hi {{first_name}},\n\nThanks for getting in touch with Filazoo. Tell us what you print and we will recommend the best materials.\n\nBest,\nFilazoo" },
  last_chance: { subject: "Should I close the loop?", body: "Hi {{first_name}},\n\nI have not heard back, so I will close the loop for now. If the project is still active, just reply and we will pick it up.\n\nBest,\nFilazoo" },
};

function firstName(name: string | null, email: string) {
  return name?.trim().split(/\s+/)[0] || email.split("@")[0] || "there";
}

function renderTemplate(value: string, contact: ContactRow) {
  return value.replaceAll("{{first_name}}", firstName(contact.name, contact.email));
}

function nextBusinessWindow(now = new Date()) {
  const next = new Date(now);
  const hour = next.getUTCHours();
  if (next.getUTCDay() !== 0 && next.getUTCDay() !== 6 && hour >= 9 && hour < 17) return null;
  if (hour >= 17) next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(9, 0, 0, 0);
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

async function resolveCompanyId(contactId?: string | null, companyId?: string | null) {
  if (companyId) return companyId;
  if (!contactId) return null;
  const { data } = await createSupabaseAdmin().from("contacts").select("company_id").eq("id", contactId).maybeSingle().throwOnError();
  return data?.company_id ?? null;
}

export async function loadFlowFacts({ userId, contactId, companyId, messageKey, lookbackDays = 365, conversationId, since: sinceDate, runId }: { userId: string; contactId?: string | null; companyId?: string | null; messageKey?: string | null; lookbackDays?: number; conversationId?: string; since?: string; runId?: string }): Promise<FlowFacts> {
  const admin = createSupabaseAdmin();
  const resolvedCompanyId = await resolveCompanyId(contactId, companyId);
  const since = new Date(Math.max(Date.now() - lookbackDays * 86_400_000, sinceDate ? Date.parse(sinceDate) : 0)).toISOString();
  let replyQuery = admin.from("emails").select("id", { count: "exact", head: true }).eq("contact_id", contactId || "00000000-0000-0000-0000-000000000000").eq("direction", "received").gt("created_at", since);
  if (conversationId && !/^(company:|shopify:)/.test(conversationId)) replyQuery = replyQuery.eq("thread_id", conversationId);
  const engagement = runId ? await admin.from("flow_run_logs").select("result").eq("run_id", runId).gte("created_at", since).in("result->>action", ["email_opened", "link_clicked"]).throwOnError() : { data: [] };
  const [companyResult, pipelineResult, profileResult, replyResult, categoryResult] = await Promise.all([
    resolvedCompanyId ? admin.from("companies").select("segment,country,status").eq("id", resolvedCompanyId).maybeSingle().throwOnError() : Promise.resolve({ data: null }),
    resolvedCompanyId ? admin.from("pipeline").select("stage").eq("company_id", resolvedCompanyId).maybeSingle().throwOnError() : Promise.resolve({ data: null }),
    resolvedCompanyId ? admin.from("company_profiles").select("fit_score").eq("company_id", resolvedCompanyId).maybeSingle().throwOnError() : Promise.resolve({ data: null }),
    contactId ? replyQuery.throwOnError() : Promise.resolve({ count: 0 }),
    messageKey ? admin.from("email_inbox_state").select("category").eq("user_id", userId).eq("message_key", messageKey).maybeSingle().throwOnError() : Promise.resolve({ data: null }),
  ]);
  return {
    customerReplied: Boolean(replyResult.count), openedEmail: Boolean(engagement.data?.some((log) => log.result?.action === "email_opened")), clickedLink: Boolean(engagement.data?.some((log) => log.result?.action === "link_clicked")),
    category: categoryResult.data?.category ?? null,
    segment: companyResult.data?.segment ?? null,
    country: companyResult.data?.country ?? null,
    companyStatus: companyResult.data?.status ?? null,
    pipelineStage: pipelineResult.data?.stage ?? null,
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
  const { data, error } = await createSupabaseAdmin().from("contacts").select("id,company_id,name,email,unsubscribed,verification_status").eq("id", contactId).maybeSingle();
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

export async function validateFlowResources(userId: string, input: FlowInput) {
  const admin = createSupabaseAdmin();
  for (const step of input.steps) {
    if (step.type === "send_email" || step.type === "ai_auto_reply") {
      const mailbox = await getMailbox({ id: "", user_id: userId, trigger_type: input.triggerType, trigger_config: input.triggerConfig, status: input.status }, step.config.mailboxId);
      if (!mailbox?.smtpHost || !mailbox.smtpUsername || !mailbox.smtpPassword) throw new Error("The selected sender mailbox needs complete SMTP settings.");
      if (step.type === "ai_auto_reply" && !hasFlowReplyProvider()) throw new Error("Configure an AI provider before enabling AI auto-reply.");
      if (step.type === "ai_auto_reply" && step.config.attachCatalog) {
        const { count } = await admin.from("products").select("sku", { count: "exact", head: true }).eq("active", true).not("sku", "like", "SAMPLE-%").not("name", "ilike", "[sample]%").throwOnError();
        if (!count) throw new Error("Add active products before attaching an AI reply catalog.");
      }
    }
    const memberId = step.type === "create_task" && step.config.assigneeType === "user" ? step.config.assigneeId : step.type === "internal_alert" && step.config.userId !== "owner" ? step.config.userId : null;
    if (memberId) {
      const { data } = await admin.from("workspace_members").select("user_id").eq("user_id", memberId).not("activated_at", "is", null).maybeSingle().throwOnError();
      if (!data) throw new Error("Choose an active workspace member for tasks and alerts.");
    }
  }
}

async function executeEmail(run: RunRow, flow: FlowRow, step: FlowStep, facts: FlowFacts) {
  if (step.type === "send_email" && step.config.stopOnReply !== false && facts.customerReplied) {
    await logRun(run.id, step.id, { action: "cancelled", reason: "Customer replied" });
    await finishRun(run.id, "cancelled");
    return "terminal" as const;
  }
  const contact = await getContact(run.contact_id);
  if (!contact) throw new Error("Email step requires a CRM contact.");
  const admin = createSupabaseAdmin();
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
  const decision = evaluateSend({ email: contact.email, verified: contact.verification_status === "valid", unsubscribed: contact.unsubscribed, suppressed: Boolean(suppressed), sentToday: count ?? 0, dailyLimit: env.DAILY_SEND_LIMIT, bounceRate: 0, bouncePausePercent: env.BOUNCE_PAUSE_PERCENT, dryRun: env.dryRun });
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
  const aiReply = step.type === "ai_auto_reply" ? await prepareFlowAiReply({ userId: flow.user_id, contactId: contact.id, companyId: contact.company_id, conversationId: run.conversation_id, config: step.config }) : null;
  if (aiReply) { subject = aiReply.subject; body = aiReply.body; }
  const { data: previous } = step.config.replyInThread !== false
    ? await admin.from("emails").select("message_id").eq("contact_id", contact.id).eq("thread_id", run.conversation_id).or(`owner_id.is.null,owner_id.eq.${flow.user_id}`).not("message_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle().throwOnError()
    : { data: null };
  const inReplyTo = aiReply?.inReplyTo || previous?.message_id;
  const threadId = aiReply?.threadId || run.conversation_id;
  const replyHeaders = inReplyTo ? { inReplyTo, references: [inReplyTo] } : {};
  const content = buildFlowEmail({ body, config: step.config, runId: run.id, stepId: step.id, flowId: flow.id, appUrl: env.NEXT_PUBLIC_APP_URL, secret: env.supabaseSecretKey! });
  const sentRecordId = randomUUID();
  const storedAttachments: Array<{ filename: string; contentType: string; size: number; path: string }> = [];
  let sent;
  try {
    for (const [index, attachment] of (aiReply?.attachments ?? []).entries()) {
      const path = `${flow.user_id}/${sentRecordId}/${index}`;
      const { error } = await admin.storage.from("mailbox-attachments").upload(path, attachment.content, { contentType: attachment.contentType, upsert: false });
      if (error) throw new Error(`Could not store the AI reply catalog: ${error.message}`);
      storedAttachments.push({ filename: attachment.filename, contentType: attachment.contentType, size: attachment.content.length, path });
    }
    sent = await sendMailboxEmail({ host: mailbox.smtpHost, port: mailbox.smtpPort, user: mailbox.smtpUsername, pass: mailbox.smtpPassword, from: mailbox.email }, { to: contact.email, subject, ...content, ...replyHeaders, attachments: aiReply?.attachments });
  } catch (error) {
    if (storedAttachments.length) await admin.storage.from("mailbox-attachments").remove(storedAttachments.map((attachment) => attachment.path));
    throw error;
  }
  await Promise.all([
    admin.from("mailbox_sent_messages").insert({ id: sentRecordId, user_id: flow.user_id, mailbox_id: mailbox.id, message_id: sent.messageId || null, thread_key: threadId, in_reply_to: inReplyTo || null, reference_ids: inReplyTo ? [inReplyTo] : [], from_email: mailbox.email, to_email: contact.email, subject, body, status: "sent", attachments: storedAttachments }).throwOnError(),
    admin.from("emails").insert({ contact_id: contact.id, direction: "sent", subject, body, thread_id: threadId, owner_id: flow.user_id, message_id: sent.messageId || null, status: "sent", step: run.current_step + 1, sent_at: new Date().toISOString() }).throwOnError(),
    logRun(run.id, step.id, { action: "email_sent", to: contact.email, subject, messageId: sent.messageId || null, aiGenerated: Boolean(aiReply), catalogAttached: Boolean(aiReply?.attachments.length) }),
  ]);
  return "continue" as const;
}

async function executeAction(run: RunRow, flow: FlowRow, step: FlowStep, facts: FlowFacts) {
  const admin = createSupabaseAdmin();
  if (step.type === "send_email" || step.type === "ai_auto_reply") return executeEmail(run, flow, step, facts);
  if (step.type === "create_task") {
    const { data: pipeline } = run.company_id && step.config.assigneeType !== "user" ? await admin.from("pipeline").select("owner_id").eq("company_id", run.company_id).maybeSingle() : { data: null };
    await admin.from("crm_tasks").insert({ flow_run_id: run.id, company_id: run.company_id, contact_id: run.contact_id, assigned_to: step.config.assigneeType === "user" ? step.config.assigneeId : pipeline?.owner_id || flow.user_id, title: step.config.title, notes: step.config.notes || null, priority: step.config.priority || "normal", due_at: new Date(Date.now() + Number(step.config.dueInDays || 0) * 86_400_000).toISOString() }).throwOnError();
    await logRun(run.id, step.id, { action: "task_created", title: step.config.title });
  } else if (step.type === "change_category") {
    const messageKey = String(run.context?.messageKey || run.conversation_id);
    await admin.from("email_inbox_state").upsert({ user_id: flow.user_id, message_key: messageKey, category: step.config.category, updated_at: new Date().toISOString() }, { onConflict: "user_id,message_key", ignoreDuplicates: false }).throwOnError();
    await logRun(run.id, step.id, { action: "category_changed", category: step.config.category, reason: step.config.reason || null });
  } else if (step.type === "internal_alert") {
    const { data: pipeline } = run.company_id ? await admin.from("pipeline").select("owner_id").eq("company_id", run.company_id).maybeSingle().throwOnError() : { data: null };
    const userId = String(step.config.userId === "owner" ? pipeline?.owner_id || flow.user_id : step.config.userId);
    await admin.from("internal_notifications").insert({ flow_run_id: run.id, user_id: userId, channel: step.config.channel || "in_app", message: step.config.message, conversation_id: run.conversation_id, include_thread_link: step.config.includeThreadLink !== false }).throwOnError();
    let delivery = "in_app";
    if (step.config.channel === "email") {
      if (env.dryRun) delivery = "email_dry_run";
      else {
        const [{ data: recipient }, mailbox] = await Promise.all([admin.auth.admin.getUserById(userId), getMailbox(flow, "default")]);
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
    const snapshot = typeof run.context?.definition === "string" ? JSON.parse(run.context.definition) as FlowStep[] : stepRows;
    const steps = (snapshot ?? []) as FlowStep[];
    flowInputSchema.parse({ name: "Runtime validation", triggerType: flow.trigger_type, triggerConfig: flow.trigger_config, status: "live", steps });
    while (index < steps.length) {
      const step = steps[index]!;
      const facts = await loadFlowFacts({ userId: flow.user_id, contactId: run.contact_id, companyId: run.company_id, messageKey: String(run.context?.messageKey || "") || run.conversation_id, lookbackDays: Number(step.config.lookbackDays || 365), conversationId: run.conversation_id, since: String(run.context?.replySince || run.started_at), runId: run.id });
      if (step.type === "wait") {
        const nextRunAt = calculateWaitUntil(step.config);
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
  if (event.flowId) flowQuery = flowQuery.eq("id", event.flowId);
  const { data: flowRows, error } = await flowQuery;
  if (error) throw new Error(`Unable to load matching flows: ${error.message}`);
  const companyId = await resolveCompanyId(event.contactId, event.companyId);
  const eventKey = event.eventKey || `${event.type}:${event.conversationId}:${randomUUID()}`;
  const results: Array<{ flowId: string; runId?: string; enrolled: boolean; reason?: string }> = [];
  for (const row of (flowRows ?? []) as FlowRow[]) {
    const facts = await loadFlowFacts({ userId: row.user_id, contactId: event.contactId, companyId, messageKey: event.messageKey });
    if (!triggerMatches(row.trigger_type, row.trigger_config ?? {}, event, facts)) { results.push({ flowId: row.id, enrolled: false, reason: "Trigger filters did not match" }); continue; }
    const { data: definition } = await admin.from("flow_steps").select("id,position,type,config").eq("flow_id", row.id).order("position").throwOnError();
    flowInputSchema.parse({ name: "Enrollment validation", triggerType: row.trigger_type, triggerConfig: row.trigger_config, status: "live", steps: definition });
    const { data: run, error: insertError } = await admin.from("flow_runs").insert({ flow_id: row.id, conversation_id: event.conversationId, event_key: eventKey, contact_id: event.contactId ?? null, company_id: companyId, current_step: 0, status: "active", next_run_at: new Date().toISOString(), context: { messageKey: event.messageKey ?? null, category: event.category ?? null, listId: event.listId ?? null, segment: event.segment ?? null, stage: event.stage ?? null, replySince: event.occurredAt ?? new Date().toISOString(), definition: JSON.stringify(definition) } }).select("id").single();
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

export async function scanTimeBasedFlowTriggers(flowId?: string) {
  const admin = createSupabaseAdmin();
  let query = admin.from("flows").select("id,user_id,trigger_type,trigger_config,status,lead_enrollment_started_at").eq("status", "live").in("trigger_type", ["new_lead", "email_received", "no_reply"]);
  if (flowId) query = query.eq("id", flowId);
  const { data: flows, error } = await query;
  if (error) throw new Error(`Unable to scan flow triggers: ${error.message}`);
  let enrolled = 0;
  for (const flow of (flows ?? []) as (FlowRow & { lead_enrollment_started_at: string | null })[]) {
    if (flow.trigger_type === "new_lead") {
      // The activation timestamp excludes existing leads and leads added while paused.
      if (!flow.lead_enrollment_started_at) continue;
      for (let offset = 0; ; offset += 500) {
        const { data: contacts } = await admin.from("contacts").select("id,company_id,created_at")
          .gte("created_at", flow.lead_enrollment_started_at).order("created_at").order("id").range(offset, offset + 499).throwOnError();
        const eventKeys = (contacts ?? []).map((contact) => `new_lead:${contact.id}`);
        const { data: existingRuns } = eventKeys.length ? await admin.from("flow_runs").select("event_key")
          .eq("flow_id", flow.id).in("event_key", eventKeys).throwOnError() : { data: [] };
        const enrolledKeys = new Set((existingRuns ?? []).map((run) => run.event_key));
        for (const contact of contacts ?? []) {
          if (enrolledKeys.has(`new_lead:${contact.id}`)) continue;
          const result = await enrollMatchingFlows({ type: "new_lead", flowId: flow.id, contactId: contact.id, companyId: contact.company_id,
            conversationId: `company:${contact.company_id}:lead:${contact.id}`, occurredAt: contact.created_at, eventKey: `new_lead:${contact.id}` });
          enrolled += result.filter((item) => item.enrolled).length;
        }
        if (!contacts || contacts.length < 500) break;
      }
    } else if (flow.trigger_type === "email_received") {
      const { data: inbound } = await admin.from("emails").select("id,contact_id,thread_id,message_id,created_at,contacts(company_id)").eq("direction", "received").or(`owner_id.is.null,owner_id.eq.${flow.user_id}`).gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(1000).throwOnError();
      for (const email of inbound ?? []) {
        const relation = email.contacts as unknown as { company_id?: string } | Array<{ company_id?: string }> | null;
        const contactCompanyId = Array.isArray(relation) ? relation[0]?.company_id : relation?.company_id;
        const result = await enrollMatchingFlows({ type: "email_received", flowId: flow.id, conversationId: email.thread_id || email.message_id || `email:${email.id}`, messageKey: email.message_id ? `imap-${email.message_id}` : undefined, occurredAt: email.created_at, eventKey: `email_received:${email.id}`, contactId: email.contact_id, companyId: contactCompanyId ?? null });
        enrolled += result.filter((item) => item.enrolled).length;
      }
    } else {
      const { data: outbound } = await admin.from("emails").select("id,contact_id,thread_id,message_id,sent_at,created_at,contacts(company_id)").eq("direction", "sent").eq("status", "sent").or(`owner_id.is.null,owner_id.eq.${flow.user_id}`).order("sent_at", { ascending: false }).limit(1000).throwOnError();
      const seen = new Set<string>();
      for (const email of outbound ?? []) {
        const conversationId = email.thread_id || email.message_id || `email:${email.id}`;
        const key = `${email.contact_id}:${conversationId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const sentAt = email.sent_at || email.created_at;
        if (calculateWaitUntil(flow.trigger_config, new Date(sentAt)).getTime() > Date.now()) continue;
        if (email.message_id) {
          const { count: automated } = await admin.from("flow_run_logs").select("id", { count: "exact", head: true }).eq("result->>action", "email_sent").eq("result->>messageId", email.message_id).throwOnError();
          if (automated) continue;
        }
        let repliesQuery = admin.from("emails").select("id", { count: "exact", head: true }).eq("contact_id", email.contact_id).eq("direction", "received").gt("created_at", sentAt);
        if (email.thread_id) repliesQuery = repliesQuery.eq("thread_id", email.thread_id);
        const { count: replies } = await repliesQuery.throwOnError();
        if (replies) continue;
        const relation = email.contacts as unknown as { company_id?: string } | Array<{ company_id?: string }> | null;
        const contactCompanyId = Array.isArray(relation) ? relation[0]?.company_id : relation?.company_id;
        const result = await enrollMatchingFlows({ type: "no_reply", flowId: flow.id, conversationId, occurredAt: sentAt, eventKey: `no_reply:${email.id}`, contactId: email.contact_id, companyId: contactCompanyId ?? null });
        enrolled += result.filter((item) => item.enrolled).length;
      }
    }
  }
  return enrolled;
}

export async function processDueFlowRuns(limit = 50) {
  const admin = createSupabaseAdmin();
  const { data: interrupted } = await admin.from("flow_runs").select("id").eq("status", "active").lt("locked_at", new Date(Date.now() - 15 * 60000).toISOString()).throwOnError();
  for (const run of interrupted ?? []) await finishRun(run.id, "failed", "Execution was interrupted. Review the last action before restarting to avoid duplicate delivery.");
  await syncFlowMailboxMessages();
  await scanTimeBasedFlowTriggers();
  const { data, error } = await admin.from("flow_runs").select("id").eq("status", "active").is("locked_at", null).or(`next_run_at.is.null,next_run_at.lte.${new Date().toISOString()}`).order("next_run_at").limit(limit);
  if (error) throw new Error(`Unable to load due flow runs: ${error.message}`);
  const results = [];
  for (const run of data ?? []) results.push({ runId: run.id, ...(await processFlowRun(run.id)) });
  return results;
}

export async function listFlowRunInsights(flowId: string, userId: string) {
  const admin = createSupabaseAdmin();
  const { data: flow } = await admin.from("flows").select("id").eq("id", flowId).eq("user_id", userId).maybeSingle();
  if (!flow) throw new Error("Flow not found.");
  const { data, error } = await admin.from("flow_runs").select("id,status,current_step,started_at,finished_at,next_run_at,conversation_id,flow_run_logs(id,result,error,created_at)").eq("flow_id", flowId).order("started_at", { ascending: false }).limit(25);
  if (error) throw new Error(`Unable to load flow insights: ${error.message}`);
  return data ?? [];
}
