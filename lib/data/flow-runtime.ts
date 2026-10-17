import "server-only";

import { calculateWaitUntil, conditionMatches, triggerMatches, type FlowFacts, type TriggerEvent } from "../flow-engine.ts";
import type { FlowStep, JsonConfig, TriggerType } from "../flows.ts";
import { env } from "../env.ts";
import { sendMailboxEmail } from "../mailer.ts";
import { normalizeMailboxRow } from "../mailbox-utils.ts";
import { evaluateSend } from "../outreach-policy.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";

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
  const { data } = await createSupabaseAdmin().from("contacts").select("company_id").eq("id", contactId).maybeSingle();
  return data?.company_id ?? null;
}

export async function loadFlowFacts({ userId, contactId, companyId, messageKey, lookbackDays = 365 }: { userId: string; contactId?: string | null; companyId?: string | null; messageKey?: string | null; lookbackDays?: number }): Promise<FlowFacts> {
  const admin = createSupabaseAdmin();
  const resolvedCompanyId = await resolveCompanyId(contactId, companyId);
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const [companyResult, pipelineResult, profileResult, replyResult, categoryResult] = await Promise.all([
    resolvedCompanyId ? admin.from("companies").select("segment,country,status").eq("id", resolvedCompanyId).maybeSingle() : Promise.resolve({ data: null }),
    resolvedCompanyId ? admin.from("pipeline").select("stage").eq("company_id", resolvedCompanyId).maybeSingle() : Promise.resolve({ data: null }),
    resolvedCompanyId ? admin.from("company_profiles").select("fit_score").eq("company_id", resolvedCompanyId).maybeSingle() : Promise.resolve({ data: null }),
    contactId ? admin.from("emails").select("id", { count: "exact", head: true }).eq("contact_id", contactId).eq("direction", "received").gte("created_at", since) : Promise.resolve({ count: 0 }),
    messageKey ? admin.from("email_inbox_state").select("category").eq("user_id", userId).eq("message_key", messageKey).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    customerReplied: Boolean(replyResult.count), openedEmail: false, clickedLink: false,
    category: categoryResult.data?.category ?? null,
    segment: companyResult.data?.segment ?? null,
    country: companyResult.data?.country ?? null,
    companyStatus: companyResult.data?.status ?? null,
    pipelineStage: pipelineResult.data?.stage ?? null,
    fitScore: profileResult.data?.fit_score == null ? null : Number(profileResult.data.fit_score),
  };
}

async function logRun(runId: string, stepId: string | null, result?: Record<string, unknown>, error?: string) {
  await createSupabaseAdmin().from("flow_run_logs").insert({ run_id: runId, step_id: stepId, result: result ?? null, error: error ?? null });
}

async function finishRun(runId: string, status: "done" | "cancelled" | "failed", error?: string) {
  await createSupabaseAdmin().from("flow_runs").update({ status, next_run_at: null, locked_at: null, finished_at: new Date().toISOString() }).eq("id", runId);
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
  const { data } = await query.limit(1).maybeSingle();
  return normalizeMailboxRow(data);
}

async function executeEmail(run: RunRow, flow: FlowRow, step: FlowStep, facts: FlowFacts) {
  if (step.config.stopOnReply !== false && facts.customerReplied) {
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
        admin.from("flow_runs").update({ next_run_at: resumeAt.toISOString(), locked_at: null }).eq("id", run.id),
        logRun(run.id, step.id, { action: "waiting_for_send_window", nextRunAt: resumeAt.toISOString() }),
      ]);
      return "waiting" as const;
    }
  }
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const { count } = await admin.from("mailbox_sent_messages").select("id", { count: "exact", head: true }).eq("user_id", flow.user_id).gte("sent_at", today.toISOString());
  const decision = evaluateSend({ email: contact.email, verified: contact.verification_status === "valid", unsubscribed: contact.unsubscribed, suppressed: false, sentToday: count ?? 0, dailyLimit: env.DAILY_SEND_LIMIT, bounceRate: 0, bouncePausePercent: env.BOUNCE_PAUSE_PERCENT, dryRun: env.dryRun });
  if (!decision.allowed) throw new Error(decision.reason);
  const template = emailTemplates[String(step.config.templateId)] ?? emailTemplates.helpful_reminder;
  const subject = renderTemplate(String(step.config.subject || template.subject), contact);
  const body = renderTemplate(template.body, contact);
  if (decision.mode === "dry-run") {
    await logRun(run.id, step.id, { action: "email_dry_run", to: contact.email, subject, reason: decision.reason });
    return "continue" as const;
  }
  const mailbox = await getMailbox(flow, step.config.mailboxId);
  if (!mailbox) throw new Error("The selected sender mailbox is unavailable.");
  const { data: previous } = step.config.replyInThread !== false
    ? await admin.from("emails").select("message_id").eq("contact_id", contact.id).eq("thread_id", run.conversation_id).not("message_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const replyHeaders = previous?.message_id ? { inReplyTo: previous.message_id, references: [previous.message_id] } : {};
  const sent = await sendMailboxEmail({ host: mailbox.smtpHost, port: mailbox.smtpPort, user: mailbox.smtpUsername, pass: mailbox.smtpPassword, from: mailbox.email }, { to: contact.email, subject, text: body, ...replyHeaders });
  await Promise.all([
    admin.from("mailbox_sent_messages").insert({ user_id: flow.user_id, mailbox_id: mailbox.id, message_id: sent.messageId || null, thread_key: run.conversation_id, in_reply_to: previous?.message_id || null, reference_ids: previous?.message_id ? [previous.message_id] : [], from_email: mailbox.email, to_email: contact.email, subject, body, status: "sent" }),
    admin.from("emails").insert({ contact_id: contact.id, direction: "sent", subject, body, thread_id: run.conversation_id, message_id: sent.messageId || null, status: "sent", step: run.current_step + 1, sent_at: new Date().toISOString() }),
    logRun(run.id, step.id, { action: "email_sent", to: contact.email, subject, messageId: sent.messageId || null }),
  ]);
  return "continue" as const;
}

async function executeAction(run: RunRow, flow: FlowRow, step: FlowStep, facts: FlowFacts) {
  const admin = createSupabaseAdmin();
  if (step.type === "send_email") return executeEmail(run, flow, step, facts);
  if (step.type === "create_task") {
    const { data: pipeline } = run.company_id && step.config.assigneeType !== "user" ? await admin.from("pipeline").select("owner_id").eq("company_id", run.company_id).maybeSingle() : { data: null };
    await admin.from("crm_tasks").insert({ flow_run_id: run.id, company_id: run.company_id, contact_id: run.contact_id, assigned_to: step.config.assigneeType === "user" ? step.config.assigneeId : pipeline?.owner_id || flow.user_id, title: step.config.title, notes: step.config.notes || null, priority: step.config.priority || "normal", due_at: new Date(Date.now() + Number(step.config.dueInDays || 0) * 86_400_000).toISOString() });
    await logRun(run.id, step.id, { action: "task_created", title: step.config.title });
  } else if (step.type === "change_category") {
    const messageKey = String(run.context?.messageKey || run.conversation_id);
    await admin.from("email_inbox_state").upsert({ user_id: flow.user_id, message_key: messageKey, category: step.config.category, updated_at: new Date().toISOString() }, { onConflict: "user_id,message_key", ignoreDuplicates: false });
    await logRun(run.id, step.id, { action: "category_changed", category: step.config.category, reason: step.config.reason || null });
  } else if (step.type === "internal_alert") {
    const userId = String(step.config.userId === "owner" ? flow.user_id : step.config.userId);
    await admin.from("internal_notifications").insert({ flow_run_id: run.id, user_id: userId, channel: step.config.channel || "in_app", message: step.config.message, conversation_id: run.conversation_id, include_thread_link: step.config.includeThreadLink !== false });
    let delivery = "in_app";
    if (step.config.channel === "email") {
      if (env.dryRun) delivery = "email_dry_run";
      else {
        const [{ data: recipient }, mailbox] = await Promise.all([admin.auth.admin.getUserById(userId), getMailbox(flow, "default")]);
        if (!recipient.user?.email || !mailbox) throw new Error("The alert recipient or sender mailbox is unavailable.");
        await sendMailboxEmail({ host: mailbox.smtpHost, port: mailbox.smtpPort, user: mailbox.smtpUsername, pass: mailbox.smtpPassword, from: mailbox.email }, { to: recipient.user.email, subject: `Filazoo CRM alert · ${flow.id.slice(0, 8)}`, text: String(step.config.message) });
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
  if (flow.status !== "live") { await finishRun(run.id, "cancelled"); return { status: "cancelled", processed: 0 }; }
  const steps = (stepRows ?? []) as FlowStep[];
  let index = run.current_step;
  let processed = 0;
  try {
    while (index < steps.length) {
      const step = steps[index]!;
      const facts = await loadFlowFacts({ userId: flow.user_id, contactId: run.contact_id, companyId: run.company_id, messageKey: String(run.context?.messageKey || "") || null, lookbackDays: Number(step.config.lookbackDays || 365) });
      if (step.type === "wait") {
        const nextRunAt = calculateWaitUntil(step.config);
        await Promise.all([
          admin.from("flow_runs").update({ current_step: index + 1, next_run_at: nextRunAt.toISOString(), locked_at: null }).eq("id", run.id),
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
        await admin.from("flow_runs").update({ current_step: index, next_run_at: null }).eq("id", run.id);
        continue;
      }
      if (step.type === "stop") {
        await logRun(run.id, step.id, { action: "stopped", reason: step.config.reason || null });
        await finishRun(run.id, step.config.outcome === "cancelled" ? "cancelled" : "done");
        return { status: step.config.outcome === "cancelled" ? "cancelled" : "done", processed: processed + 1 };
      }
      const result = await executeAction(run, flow, step, facts);
      processed += 1;
      if (result === "terminal") return { status: "cancelled", processed };
      if (result === "waiting") return { status: "waiting", processed };
      index += 1;
      await admin.from("flow_runs").update({ current_step: index, next_run_at: null }).eq("id", run.id);
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
  const eventKey = event.eventKey || `${event.type}:${event.conversationId}:${event.category || event.listId || event.segment || event.stage || "event"}`;
  const results: Array<{ flowId: string; runId?: string; enrolled: boolean; reason?: string }> = [];
  for (const row of (flowRows ?? []) as FlowRow[]) {
    const facts = await loadFlowFacts({ userId: row.user_id, contactId: event.contactId, companyId, messageKey: event.messageKey });
    if (!triggerMatches(row.trigger_type, row.trigger_config ?? {}, event, facts)) { results.push({ flowId: row.id, enrolled: false, reason: "Trigger filters did not match" }); continue; }
    const { data: run, error: insertError } = await admin.from("flow_runs").insert({ flow_id: row.id, conversation_id: event.conversationId, event_key: eventKey, contact_id: event.contactId ?? null, company_id: companyId, current_step: 0, status: "active", next_run_at: new Date().toISOString(), context: { messageKey: event.messageKey ?? null, category: event.category ?? null, listId: event.listId ?? null, segment: event.segment ?? null, stage: event.stage ?? null } }).select("id").single();
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

function subtractTriggerDuration(config: JsonConfig) {
  const result = new Date();
  const amount = Math.max(1, Number(config.amount) || 1);
  if (config.unit === "hours") result.setUTCHours(result.getUTCHours() - amount);
  else if (config.businessDays) {
    let remaining = amount;
    while (remaining > 0) {
      result.setUTCDate(result.getUTCDate() - 1);
      if (result.getUTCDay() !== 0 && result.getUTCDay() !== 6) remaining -= 1;
    }
  } else result.setUTCDate(result.getUTCDate() - amount);
  return result.toISOString();
}

export async function scanTimeBasedFlowTriggers() {
  const admin = createSupabaseAdmin();
  const { data: flows, error } = await admin.from("flows").select("id,user_id,trigger_type,trigger_config,status").eq("status", "live").in("trigger_type", ["email_received", "no_reply"]);
  if (error) throw new Error(`Unable to scan flow triggers: ${error.message}`);
  let enrolled = 0;
  for (const flow of (flows ?? []) as FlowRow[]) {
    if (flow.trigger_type === "email_received") {
      const { data: inbound } = await admin.from("emails").select("id,contact_id,thread_id,message_id,created_at,contacts(company_id)").eq("direction", "received").gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(100);
      for (const email of inbound ?? []) {
        const relation = email.contacts as unknown as { company_id?: string } | Array<{ company_id?: string }> | null;
        const contactCompanyId = Array.isArray(relation) ? relation[0]?.company_id : relation?.company_id;
        const result = await enrollMatchingFlows({ type: "email_received", flowId: flow.id, conversationId: email.thread_id || email.message_id || `email:${email.id}`, eventKey: `email_received:${email.id}`, contactId: email.contact_id, companyId: contactCompanyId ?? null });
        enrolled += result.filter((item) => item.enrolled).length;
      }
    } else {
      const cutoff = subtractTriggerDuration(flow.trigger_config ?? {});
      const { data: outbound } = await admin.from("emails").select("id,contact_id,thread_id,message_id,sent_at,created_at,contacts(company_id)").eq("direction", "sent").eq("status", "sent").lte("sent_at", cutoff).order("sent_at", { ascending: false }).limit(100);
      for (const email of outbound ?? []) {
        const sentAt = email.sent_at || email.created_at;
        const { count: replies } = await admin.from("emails").select("id", { count: "exact", head: true }).eq("contact_id", email.contact_id).eq("direction", "received").gt("created_at", sentAt);
        if (replies) continue;
        const relation = email.contacts as unknown as { company_id?: string } | Array<{ company_id?: string }> | null;
        const contactCompanyId = Array.isArray(relation) ? relation[0]?.company_id : relation?.company_id;
        const result = await enrollMatchingFlows({ type: "no_reply", flowId: flow.id, conversationId: email.thread_id || email.message_id || `email:${email.id}`, eventKey: `no_reply:${email.id}`, contactId: email.contact_id, companyId: contactCompanyId ?? null });
        enrolled += result.filter((item) => item.enrolled).length;
      }
    }
  }
  return enrolled;
}

export async function processDueFlowRuns(limit = 50) {
  const admin = createSupabaseAdmin();
  await scanTimeBasedFlowTriggers();
  const { data, error } = await admin.from("flow_runs").select("id").eq("status", "active").or(`next_run_at.is.null,next_run_at.lte.${new Date().toISOString()}`).order("next_run_at").limit(limit);
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
