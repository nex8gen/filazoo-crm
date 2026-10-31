import "server-only";
import { requireAiAutomation } from "./ai-settings";
import { aiBehaviorInstruction } from "../ai-policy";
import { z } from "zod";
import { createHash } from "node:crypto";
import { createSupabaseAdmin } from "../supabase/admin";
import type { WorkspaceViewer } from "../auth";
import type { ReplyRequestRow } from "./customer-reply-requests";
import { authorizeReplyRequest } from "./customer-reply-requests";
import { getViewerMailbox, mailboxHasSmtp } from "./mailboxes";
import { loadSyncedMailbox, loadMailboxMessageContent } from "./mailbox-sync";
import { normalizeMessageId, normalizeReferences } from "../email-threading";
import { splitQuotedEmail } from "../email-content";
import { replyTaskEvidence } from "../customer-reply-workflow";
import { invoiceBootstrap } from "./invoice-connections";
import { createInvoice, getInvoice, mutateInvoice } from "./invoices";
import { invoiceDocumentSchema, invoiceTotals, invoiceLabel, type Invoice } from "../invoices";
import { invoiceProduct } from "../invoice-links";
import { replyInvoiceLines } from "../ai/email-reply";
import { userProductRows } from "./product-personalization";
import { getInvoiceDefaults } from "./invoice-defaults";
import { generateGeminiText } from "../ai/gemini";
import { generateGatewayText, isGeminiRegionError } from "../ai/gateway";
import { canEditInvoice } from "../invoice-permissions";
import { taskWorkflowInputSchema, groundedReplyChanges, workflowAddress, replyWorkInstruction, replyWorkPlanSchema, type ReplyWorkPlan, type TaskWorkflow, type WorkflowPayload } from "../task-workflows";

export async function workflowOwner(userId: string): Promise<WorkspaceViewer> {
  const db = createSupabaseAdmin();
  const [{ data: member }, auth] = await Promise.all([
    db.from("workspace_members").select("role,display_name,activated_at").eq("user_id", userId).maybeSingle().throwOnError(),
    db.auth.admin.getUserById(userId),
  ]);
  const user = auth.data.user;
  if (auth.error || !member?.activated_at || member.role === "viewer" || !user || (user.banned_until && Date.parse(user.banned_until) > Date.now())) throw new Error("The task owner no longer has an active sales account.");
  return { id: userId, email: user.email ?? null, role: member.role, displayName: member.display_name } as WorkspaceViewer;
}

export async function latestWorkflowEvidence(viewer: WorkspaceViewer, request: ReplyRequestRow) {
  const mailbox = await authorizeReplyRequest(viewer, request);
  const db = createSupabaseAdmin();
  const { data: saved } = await db.from("agent_reply_requests").select("reply_evidence").eq("id", request.id).single().throwOnError();
  let evidence = saved.reply_evidence as WorkflowPayload["evidence"];
  if (request.status === "uncertain") return { evidence: undefined, mailbox };
  if (request.status === "received" && (!evidence?.text || !evidence.messageId)) throw new Error("The customer reply evidence is unavailable.");
  const inbox = await loadSyncedMailbox(mailbox, { sync: false, includeContent: false });
  if (inbox.error) throw new Error("Unable to verify the current customer conversation.");
  const anchors = new Set([normalizeMessageId(request.message_id), normalizeMessageId(evidence?.messageId)].filter(Boolean));
  const newest = inbox.messages.filter(email => email.direction === "inbound" && !email.automaticResponse && !email.demo && email.contact.toLowerCase() === request.recipient.toLowerCase()
    && Date.parse(email.timestamp) >= Date.parse(evidence?.timestamp ?? request.waiting_since ?? "")
    && [normalizeMessageId(email.messageId), normalizeMessageId(email.inReplyTo), ...normalizeReferences(email.references)].some(id => anchors.has(id)))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  if (newest && normalizeMessageId(newest.messageId) !== normalizeMessageId(evidence?.messageId)) {
    const email = !newest.bodyLoaded && newest.uid && newest.uidValidity ? await loadMailboxMessageContent(mailbox, newest.uid, newest.uidValidity) : newest;
    evidence = replyTaskEvidence(email);
  }
  return { evidence, mailbox };
}

async function planWork(prompt: string) {
  const policy = await requireAiAutomation([], ["emails", "customers", "billing", "products", "tasks"]);
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const token = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
  const responseJsonSchema = z.toJSONSchema(replyWorkPlanSchema.extend({ changes: replyWorkPlanSchema.shape.changes.required() }), { unrepresentable: "any", target: "draft-7" });
  delete responseJsonSchema.$schema;
  const options = { prompt, systemInstruction: `${replyWorkInstruction}${aiBehaviorInstruction(policy, true)}\nExact JSON schema: ${JSON.stringify(responseJsonSchema)}`, responseJsonSchema, maxOutputTokens: 6000,
    fetcher: ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(45_000) })) as typeof fetch };
  const gateway = () => {
    if (!token) throw new Error("AI preparation is unavailable. Add a provider or prepare this task manually.");
    return generateGatewayText({ ...options, token, model: process.env.AI_GATEWAY_AGENT_MODEL?.trim() || process.env.AI_GATEWAY_EMAIL_MODEL?.trim() });
  };
  let output: string;
  try { output = apiKey ? await generateGeminiText({ ...options, apiKey, model: process.env.GEMINI_AGENT_MODEL?.trim() || process.env.GEMINI_EMAIL_MODEL?.trim() }) : await gateway(); }
  catch (error) { if (!apiKey || !token || !isGeminiRegionError(error)) throw error; output = await gateway(); }
  try { return replyWorkPlanSchema.parse(JSON.parse(output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""))); }
  catch { throw new Error("The AI returned incomplete preparation details. Prepare again or review the customer's information."); }
}

export async function prepareTaskWorkflow(work: TaskWorkflow) {
  await requireAiAutomation(["tasks", ...(work.kind === "invoice_review" ? ["invoices"] as const : [])], ["emails", "customers", "billing", "products", "tasks"]);
  const db = createSupabaseAdmin();
  const viewer = await workflowOwner(work.owner_id);
  const { data: task } = await db.from("crm_tasks").select("id,company_id,assigned_to,status,title,notes").eq("id", work.task_id).single().throwOnError();
  if (task.status !== "open" || !task.company_id || task.assigned_to !== viewer.id) throw new Error("The task was completed, reassigned, or lost its company link.");
  if (viewer.role === "bd_manager") {
    const { data } = await db.from("pipeline").select("company_id").eq("company_id", task.company_id).eq("owner_id", viewer.id).maybeSingle().throwOnError();
    if (!data) throw new Error("The company is no longer assigned to the task owner.");
  }
  const input = taskWorkflowInputSchema.parse(work.payload.input ?? { kind: work.kind });
  const { data: requestData } = work.request_id ? await db.from("agent_reply_requests").select("*").eq("id", work.request_id).single().throwOnError() : { data: null };
  const request = requestData as ReplyRequestRow | null;
  const source = request ? await latestWorkflowEvidence(viewer, request) : null;
  const mailbox = source?.mailbox ?? await getViewerMailbox(viewer.id, input.mailboxId);
  if (!mailbox || !mailboxHasSmtp(mailbox)) throw new Error("The sending mailbox is unavailable. Check Settings and prepare again.");
  const bootstrap = await invoiceBootstrap({ userId: viewer.id, companyId: task.company_id, ...(request ? { email: request.recipient, threadId: request.thread_key ?? undefined } : {}) });
  const recipient = request?.recipient || bootstrap.document.customerEmail;
  const companyLocation = { city: bootstrap.billing?.customer.city, country: bootstrap.billing?.customer.country };
  if (!recipient) throw new Error("Add a business email for this customer before preparing the task.");
  const evidence = source?.evidence;
  const newestReply = evidence?.text ? splitQuotedEmail(evidence.text).current : "";
  const snapshot = request?.invoice_context as { items?: Array<{ productSku?: string; variantId?: string; quantity: number }> } | null;
  const knownItems = input.items?.length ? input.items : snapshot?.items?.length && snapshot.items.every(item => item.productSku) ? snapshot.items.map(item => ({ productSku: item.productSku!, variantId: item.variantId ?? null, quantity: item.quantity })) : [];
  const products = work.kind === "invoice_review" ? await userProductRows(viewer.id, knownItems.length ? [...new Set(knownItems.map(item => item.productSku))] : undefined) : [];
  let invoice: Invoice | null = work.invoice_id ? await getInvoice(work.invoice_id) : null;
  if (invoice && invoice.document.companyId !== task.company_id) throw new Error("The invoice belongs to another company.");
  let plan: ReplyWorkPlan = { summary: request?.status === "expired" ? "The waiting period ended. Review and send a follow-up." : "Review this prepared work before sending.", changes: {}, items: knownItems.map(item => ({ ...item, variantId: item.variantId ?? null })), missing: [],
    subject: input.subject || (request ? `Re: ${request.subject.replace(/^(re:\s*)+/i, "")}` : "Following up"),
    text: input.text || `Hello ${bootstrap.document.customerName},\n\nI am following up on our previous conversation. Please let us know if you have any questions or an update.\n\nThank you.` };
  if (newestReply || (work.kind === "invoice_review" && !knownItems.length)) {
    const prompt = JSON.stringify({ kind: work.kind, task: { title: task.title, instructions: request?.task_notes ?? task.notes }, needed: request?.needed,
      newestCustomerReply: newestReply, savedInvoicePlan: knownItems, savedCustomerDetails: bootstrap.billing?.profile,
      currentInvoice: invoice ? { status: invoice.status, number: invoice.number, totalMinor: invoice.total_minor, paidMinor: invoice.paid_minor, currency: invoice.document.currency } : null,
      liveProducts: products.filter(p => p.active).map(p => { const item = invoiceProduct({ ...p, tags: p.tags ?? [] }); return { sku: item.sku, name: item.name, variants: item.variants.map(v => ({ id: v.id, name: v.name })) }; }) });
    if (prompt.length > 180_000) throw new Error("Narrow the task's product selection before preparing it.");
    plan = await planWork(prompt);
    plan.changes = groundedReplyChanges(plan.changes, newestReply);
    if (plan.missing.includes("shipping_address")) delete plan.changes.shippingAddress;
    if (plan.missing.includes("billing_address")) delete plan.changes.address;
    if (input.text) plan.text = input.text;
    if (input.subject) plan.subject = input.subject;
    else if (request) plan.subject = `Re: ${request.subject.replace(/^(re:\s*)+/i, "")}`;
  }
  const blockers: string[] = [];
  for (const missing of plan.missing) {
    if (request?.needed.includes(missing)) blockers.push(`The customer reply still needs confirmed ${missing.replaceAll("_", " ")}.`);
  }
  let shippingConfirmed = work.payload.shippingConfirmed ?? input.shippingMinor !== undefined;
  if (work.kind === "invoice_review") {
    const items = request?.needed.some(field => field === "products" || field === "quantity") && plan.items.length ? plan.items : knownItems.length ? knownItems : plan.items;
    if (!items.length && !invoice) blockers.push("Choose the exact products, variants and quantities for this invoice.");
    if (!invoice && items.length) {
      const resolved = replyInvoiceLines(items.map(item => ({ ...item, variantId: item.variantId ?? null })), products.filter(p => p.active).map(p => invoiceProduct({ ...p, tags: p.tags ?? [] })));
      const defaults = await getInvoiceDefaults();
      const document = invoiceDocumentSchema.parse({ ...bootstrap.document, customerEmail: recipient,
        customerAddress: plan.changes.address || workflowAddress(bootstrap.billing?.profile?.address || bootstrap.document.customerAddress, companyLocation), customerTaxId: plan.changes.taxId || bootstrap.document.customerTaxId,
        shippingAddress: plan.changes.shippingAddress || bootstrap.document.shippingAddress,
        shippingRecipient: plan.changes.shippingRecipient || bootstrap.document.shippingRecipient,
        shippingPhone: plan.changes.shippingPhone || bootstrap.document.shippingPhone,
        currency: resolved.currency, items: resolved.lines.map(item => ({ ...item, taxBps: defaults.defaults.taxBps })), shippingMinor: input.shippingMinor ?? 0,
        paymentMethods: bootstrap.document.paymentMethods?.filter(method => !method.currency || method.currency === resolved.currency) });
      // Deterministic identity recovers a crash after draft creation without creating another invoice.
      invoice = await getInvoice(work.task_id);
      if (invoice && (invoice.document.companyId !== task.company_id || invoice.created_by !== viewer.id)) throw new Error("This invoice identity belongs to different work.");
      invoice ??= await createInvoice(document, viewer.id, work.task_id);
    } else if (invoice && Object.keys(plan.changes).length && (!work.payload.preparedAt || invoice.revision === work.payload.invoiceRevision)) {
      if (canEditInvoice(viewer, invoice)) {
        const document = invoiceDocumentSchema.parse({ ...invoice.document,
          ...(plan.changes.shippingAddress ? { shippingAddress: plan.changes.shippingAddress } : {}),
          ...(plan.changes.shippingRecipient ? { shippingRecipient: plan.changes.shippingRecipient } : {}),
          ...(plan.changes.shippingPhone ? { shippingPhone: plan.changes.shippingPhone } : {}),
          ...(plan.changes.address ? { customerAddress: plan.changes.address } : {}),
          ...(plan.changes.taxId ? { customerTaxId: plan.changes.taxId } : {}),
          ...(input.shippingMinor !== undefined ? { shippingMinor: input.shippingMinor } : {}) });
        if (JSON.stringify(document) !== JSON.stringify(invoice.document)) invoice = await mutateInvoice(invoice.id, viewer.id, { action: "save", revision: invoice.revision, document, totalMinor: invoiceTotals(document).total });
      } else blockers.push("The linked invoice is already issued or belongs to another editor. Review it before continuing.");
    }
    if (invoice?.revision !== work.payload.invoiceRevision && work.payload.preparedAt) shippingConfirmed = false;
    if (invoice && !workflowAddress(invoice.document.customerAddress, companyLocation)) blockers.push("Confirm the billing address in the invoice.");
    if (invoice && !workflowAddress(invoice.document.shippingAddress, companyLocation)) blockers.push("Add a complete shipping address to the invoice.");
    if (invoice && !input.text) plan.text = `Hello ${invoice.document.shippingRecipient || invoice.document.customerName},\n\nPlease find ${invoice.status === "draft" ? "your draft invoice for review" : "your invoice"} ${invoiceLabel(invoice)} attached. Please review the items, delivery details and total, and let us know if any changes are needed.\n\nThank you.`;
  }
  if (work.kind === "payment_follow_up") {
    if (!invoice || invoice.status !== "issued" || invoice.paid_minor >= invoice.total_minor) blockers.push("This invoice no longer has an outstanding balance to follow up on.");
    else {
      plan.subject = input.subject || `Payment reminder: ${invoiceLabel(invoice)}`;
      plan.text = input.text || `Hello ${invoice.document.customerName},\n\nWe are following up on ${invoiceLabel(invoice)}. The outstanding balance is ${new Intl.NumberFormat("en", { style: "currency", currency: invoice.document.currency }).format((invoice.total_minor - invoice.paid_minor) / 100)}. Please let us know if payment has been arranged or if you need assistance.\n\nThank you.`;
    }
  }
  if (work.kind === "customer_details" && !Object.keys(plan.changes).length && !work.payload.detailsApplied) blockers.push("The reply did not contain complete, verifiable customer details. Review the original reply or request the missing information.");
  const detailsApplied = Boolean(work.payload.detailsApplied && normalizeMessageId(work.payload.evidence?.messageId) === normalizeMessageId(evidence?.messageId));
  const payload: WorkflowPayload = { ...work.payload, input, recipient, mailboxId: mailbox.id, subject: plan.subject, text: plan.text,
    threadKey: request?.thread_key ?? undefined, inReplyTo: evidence?.messageId || request?.message_id || undefined,
    references: [request?.message_id, evidence?.messageId].filter((id): id is string => Boolean(id)),
    evidence, changes: detailsApplied ? {} : plan.changes, detailsApplied, profileBaseline: bootstrap.billing?.profile ?? {},
    shippingConfirmed, companyLocation, invoiceRevision: invoice?.revision, preparedAt: new Date().toISOString(), summary: plan.summary };
  delete payload.error;
  delete payload.deliveryId;
  delete payload.deliveryResult;
  // A second worker or cancelled task cannot replace this preparation's result.
  const { data: currentTask } = await db.from("crm_tasks").select("status,assigned_to").eq("id", work.task_id).single().throwOnError();
  if (currentTask.status !== "open" || currentTask.assigned_to !== viewer.id) throw new Error("The task changed while preparing it.");
  const { data: saved } = await db.from("crm_task_workflows").update({ status: blockers.length ? "blocked" : "ready", payload, blockers,
    invoice_id: invoice?.id ?? null, revision: work.revision + 1, lease_until: null, updated_at: new Date().toISOString() }).eq("task_id", work.task_id).eq("revision", work.revision).select("task_id").maybeSingle().throwOnError();
  if (!saved) throw new Error("Another employee changed the task while it was preparing.");
  return { invoiceId: invoice?.id ?? null, fingerprint: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
}
