import "server-only";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import type { WorkspaceViewer } from "../auth.ts";
import { env } from "../env.ts";
import { flowActionLocations } from "../flow-tree.ts";
import { calculateWaitUntil } from "../flow-engine.ts";
import { normalizeMailboxRows } from "../mailbox-utils.ts";
import { resolveFlowSender } from "../flow-mailboxes.ts";
import { verifyMailboxSmtp } from "../mailer.ts";
import { verifyGatewayAccess } from "../ai/gateway-health.ts";
import { requireAiAutomation } from "./ai-settings.ts";
import { loadFlowReplyProducts } from "./flow-ai-reply.ts";
import { listSegmentCompanies } from "./crm.ts";
import { matchesSegment, segmentRulesSchema } from "../segments.ts";
import { validateEmailFlowScope } from "./email-flows.ts";
import { stepLabels } from "../flows.ts";
import { workflowErrorMessage } from "../flow-execution-errors.ts";
import { flowCheckStatus, type FlowCheck, type FlowCheckInput, type FlowCheckResult } from "../flow-check.ts";
import { assignedFlowCandidates, assignedFlowActor } from "./flow-sender.ts";
import { evaluateSend } from "../outreach-policy.ts";

/** Real, bounded, read-only probes; no generation, SMTP submission, or CRM writes. */
export async function checkFlow(input: FlowCheckInput, viewer: WorkspaceViewer): Promise<FlowCheckResult> {
  const start = Date.now();
  const signal = AbortSignal.timeout(7_000);
  const admin = createSupabaseAdmin();
  const checks: FlowCheck[] = [];
  const locations = flowActionLocations(input.flow.steps);
  let ownerId = viewer.id;
  if (input.flowId) {
    const { data } = await admin.from("flows").select("user_id,trigger_config").eq("id", input.flowId).abortSignal(signal).maybeSingle().throwOnError();
    if (!data) throw new Error("Workflow not found.");
    if (viewer.role !== "admin" && data.user_id !== viewer.id) throw new Error("Only the workflow owner or an administrator can test its sender connections.");
    ownerId = data.user_id;
  }
  if (input.flow.triggerConfig.flowScope) await validateEmailFlowScope(input.flow.triggerConfig);
  checks.push({ id: "definition", label: "All actions and branches", status: "passed", detail: `${locations.length} actions checked with the production workflow validator.` });
  const add = async (id: string, label: string, run: () => Promise<Omit<FlowCheck, "id" | "label">>) => {
    const fail = () => rejectTimeout(new Error("Check timed out. This dependency has not been verified."));
    let rejectTimeout: (reason: Error) => void;
    const timeout = new Promise<never>((_, reject) => { rejectTimeout = reject; });
    if (signal.aborted) fail(); else signal.addEventListener("abort", fail, { once: true });
    try { checks.push({ id, label, ...await Promise.race([run(), timeout]) }); }
    catch (cause) { const detail = workflowErrorMessage(cause); checks.push({ id, label, status: /timeout|timed out|aborted/i.test(detail) ? "unverified" : "blocked", detail }); }
    finally { signal.removeEventListener("abort", fail); }
  };
  const actions = locations.map(item => item.action);
  const hasMessages = actions.some(step => ["send_email", "ai_auto_reply"].includes(step.type));
  const senderActions = actions.filter(step => ["send_email", "ai_auto_reply"].includes(step.type) || step.type === "internal_alert" && step.config.channel === "email");
  const hasAi = actions.some(step => step.type === "ai_auto_reply");
  const tables = new Set(["flow_runs", "flow_steps", "flow_run_logs"]);
  for (const step of actions) {
    if (step.type === "create_task") tables.add("crm_tasks");
    if (step.type === "change_category") tables.add("crm_email_tags");
    if (step.type === "update_company") { tables.add("companies"); tables.add("events"); }
    if (step.type === "internal_alert") tables.add("internal_notifications");
    if (["send_email", "ai_auto_reply"].includes(step.type)) { tables.add("emails"); tables.add("mailbox_sent_messages"); }
  }
  const jobs: Promise<void>[] = [add("database", "Workflow and action storage", async () => {
    await Promise.all([...tables].map(table => admin.from(table).select("*", { head: true }).limit(1).abortSignal(signal).throwOnError()));
    return { status: "passed", detail: "The workflow and every action's required tables are reachable. No records were changed." };
  })];
  if (senderActions.length) jobs.push(add("senders", "Sender authentication", async () => {
    const hasAssigned = senderActions.some(step => step.config.mailboxId === "assigned_owner");
    const actors = hasAssigned ? await assignedFlowCandidates(ownerId, typeof input.flow.triggerConfig.scopeCompanyId === "string" ? input.flow.triggerConfig.scopeCompanyId : undefined) : [];
    const { data } = await admin.from("workspace_mailboxes").select("*").or(`type.eq.workspace,user_id.in.(${[ownerId, ...actors].join(",")})`).abortSignal(signal).throwOnError();
    const mailboxes = normalizeMailboxRows(data);
    const senders = new Map<string, (typeof mailboxes)[number]>();
    for (const step of senderActions) {
      for (const actor of step.config.mailboxId === "assigned_owner" ? actors : [ownerId]) {
      const mailbox = resolveFlowSender(mailboxes, actor, step.config.mailboxId === "assigned_owner" ? "owner" : step.config.mailboxId);
      if (!mailbox?.isActive || !mailbox.smtpHost || !mailbox.smtpUsername || !mailbox.smtpPassword) throw new Error("An action's selected sender is unavailable or has incomplete SMTP settings.");
      senders.set(mailbox.id, mailbox);
      }
    }
    await Promise.all([...senders.values()].map(mailbox => verifyMailboxSmtp({ host: mailbox.smtpHost, port: mailbox.smtpPort, user: mailbox.smtpUsername, pass: mailbox.smtpPassword, from: mailbox.email }, { timeoutMs: 3_500 })));
    return { status: "passed", detail: `${senders.size} sender connections authenticated with their mail servers. No email was sent.` };
  }));
  if (hasAi) jobs.push(add("ai", "AI authentication and access", async () => {
    await requireAiAutomation(["sending", ...(actions.some(step => step.type === "ai_auto_reply" && step.config.attachCatalog) ? ["catalogs"] as const : [])], ["emails", "customers", "team", ...(actions.some(step => step.type === "ai_auto_reply" && (step.config.useProducts || step.config.attachCatalog)) ? ["products"] as const : [])]);
    await verifyGatewayAccess({ signal });
    return { status: "passed", detail: "AI Gateway accepted the current credentials. Automation permissions are enabled. Generation is checked by the delivery test." };
  }));
  if (actions.some(step => step.type === "ai_auto_reply" && (step.config.useProducts || step.config.attachCatalog) || step.type === "send_email" && step.config.templateId === "send_catalog")) jobs.push(add("products", "Products and catalog", async () => {
    const products = await loadFlowReplyProducts({ useProducts: true, attachCatalog: true }, ownerId);
    if (!products.length) throw new Error("The workflow owner has no active products available for the requested catalog or product reply.");
    return { status: "passed", detail: `${products.length} active products are available to the workflow owner.` };
  }));
  const assignedIds = actions.flatMap(step => step.type === "create_task" && step.config.assigneeType === "user" ? [String(step.config.assigneeId)] : step.type === "internal_alert" && step.config.userId !== "owner" ? [String(step.config.userId)] : []);
  if (assignedIds.length) jobs.push(add("members", "Task and alert recipients", async () => {
    const { data } = await admin.from("workspace_members").select("user_id,role").in("user_id", [...new Set(assignedIds)]).not("activated_at", "is", null).abortSignal(signal).throwOnError();
    for (const step of actions) {
      const id = step.type === "create_task" && step.config.assigneeType === "user" ? step.config.assigneeId : step.type === "internal_alert" && step.config.userId !== "owner" ? step.config.userId : null;
      if (!id) continue;
      const member = data?.find(member => member.user_id === id);
      if (!member || step.type === "create_task" && member.role === "viewer") throw new Error("A task or alert points to an unavailable member or a read-only task assignee.");
    }
    return { status: "passed", detail: "Every selected task and alert recipient is an active, eligible workspace member." };
  }));
  const config = input.flow.triggerConfig;
  if (hasMessages && input.flow.triggerType === "company_segment_changed") jobs.push(add("audience", "Segment recipients", async () => {
    const [{ companies }, segment] = await Promise.all([listSegmentCompanies(), typeof config.savedSegmentId === "string" ? admin.from("company_segments").select("rules").eq("id", config.savedSegmentId).abortSignal(signal).maybeSingle().throwOnError() : Promise.resolve({ data: null })]);
    if (config.savedSegmentId && !segment.data) throw new Error("The workflow's saved segment no longer exists.");
    const rules = segmentRulesSchema.parse(segment.data?.rules ?? { businessSegment: config.segment });
    const audience = companies.filter(company => matchesSegment(company, rules));
    if (!audience.length) return { status: "warning", detail: "No companies match this segment yet. Future matches will be checked on entry." };
    if (audience.length > 500) return { status: "unverified", detail: "This audience exceeds the bounded recipient check. Review recipients in batches before releasing this workflow." };
    const blocked: typeof audience = [];
    for (let offset = 0; offset < audience.length; offset += 50) {
      const batch = audience.slice(offset, offset + 50);
      const { data: contacts } = await admin.from("contacts").select("id,company_id,email,verification_status,consent_source,unsubscribed")
        .in("company_id", batch.map(company => company.id)).abortSignal(signal).throwOnError();
      for (const company of batch) {
        const recipients = (contacts ?? []).filter(contact => contact.company_id === company.id && contact.email
          && (!Array.isArray(config.contactIds) || config.contactIds.includes(contact.id)) && (!config.scopeContactId || config.scopeContactId === contact.id));
        if (recipients.length !== 1) { blocked.push(company); continue; }
        const recipient = recipients[0];
        const actor = actions.some(step => step.config.mailboxId === "assigned_owner") ? await assignedFlowActor(ownerId, company.id) : ownerId;
        const [{ count: suppressed }, { count: inquiries }] = await Promise.all([
          admin.from("suppression").select("email", { count: "exact", head: true }).eq("email", recipient.email).abortSignal(signal).throwOnError(),
          admin.from("emails").select("id", { count: "exact", head: true }).eq("contact_id", recipient.id).eq("direction", "received").or(`owner_id.is.null,owner_id.eq.${actor}`).abortSignal(signal).throwOnError(),
        ]);
        const inquiryResponse = ["unverified", "unknown"].includes(recipient.verification_status) && (Boolean(inquiries) || ["shopify_b2b_form", "shopify_b2b_form_opt_in", "meta_lead_ads"].includes(recipient.consent_source));
        if (!evaluateSend({ email: recipient.email, verified: recipient.verification_status === "valid", inquiryResponse,
          unsubscribed: recipient.unsubscribed, suppressed: Boolean(suppressed), sentToday: 0, dailyLimit: env.DAILY_SEND_LIMIT, bounceRate: 0, bouncePausePercent: env.BOUNCE_PAUSE_PERCENT, dryRun: false }).allowed) blocked.push(company);
      }
    }
    return { status: blocked.length ? "blocked" : "passed", detail: blocked.length ? `${blocked.length} of ${audience.length} companies need a single eligible contact. Check address verification, consent, unsubscribe and suppression. Blocked actions remain visible in Insights.` : `${audience.length} companies each have an eligible contact. Live restrictions and mailbox capacity are checked again before each send.`, links: blocked.slice(0, 10).map(company => ({ label: company.name, href: `/companies/${company.id}` })) };
  }));
  if (hasMessages && env.dryRun) checks.push({ id: "sending", label: "Live sending", status: "warning", detail: "This server is in dry-run mode. Live workflows record previews; explicit delivery tests can still send to your test inbox." });
  if (input.flowId) jobs.push(add("queue", "Saved workflow progress", async () => {
    const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
    const { count } = await admin.from("flow_runs").select("id", { count: "exact", head: true }).eq("flow_id", input.flowId).eq("status", "active").lt("next_run_at", cutoff).abortSignal(signal).throwOnError();
    return { status: count ? "warning" : "passed", detail: count ? `${count} runs are overdue by more than five minutes. Review Insights and the background worker before releasing more work.` : "No scheduled runs are overdue by more than five minutes. This does not verify future trigger delivery." };
  }));
  await Promise.all(jobs);
  for (const location of locations) {
    const step = location.action;
    const issue = step.type === "wait" && !Number.isFinite(calculateWaitUntil(step.config).getTime());
    checks.push({ id: `action:${location.path.join(".")}`, label: stepLabels[step.type], status: issue ? "blocked" : "passed", detail: step.type === "wait" ? "Delay is valid. Fast delivery tests skip this wait without editing it." : step.type === "split" || step.type === "if_condition" ? "Condition and every branch passed the production validator. Future events determine which path runs." : "Action settings passed the production validator; required live resources are checked above.", actionPath: location.path });
  }
  return { status: flowCheckStatus(checks), checkedAt: new Date().toISOString(), durationMs: Date.now() - start, checks, actionCount: locations.length };
}
