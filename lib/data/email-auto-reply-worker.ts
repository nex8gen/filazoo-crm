import "server-only";
import { randomUUID } from "node:crypto";
import { prepareUserEmail } from "./email-footers";
import { createSupabaseAdmin } from "../supabase/admin";
import type { WorkspaceViewer } from "../auth";
import { autoReplyConversation, autoReplyInstruction, autoReplyPlanSchema, latestCustomerMessage, mergeAutoReplyHistory, messageIdentity, isAutoReplySchemaMissing, type AutoReplyPlan } from "../email-auto-reply";
import { authorizeAutoReply, hydrateAutoReplyHistory, mailboxHistory, type AutoReplyRow } from "./email-auto-reply";
import { loadFlowReplyProducts } from "./flow-ai-reply";
import { invoiceProduct } from "../invoice-links";
import { replyInvoiceLines } from "../ai/email-reply";
import { generateGeminiText } from "../ai/gemini";
import { generateGatewayText, isGeminiRegionError } from "../ai/gateway";
import { applyEmailSignature, DEFAULT_EMAIL_COMPANY, DEFAULT_EMAIL_TITLE } from "../ai/email-rewrite";
import { crmProduct } from "../product-utils";
import { buildServerCatalogPdf } from "../catalog-pdf-server";
import { ensureCompanyCatalogPdf } from "./catalog-pdfs";
import { invoiceBootstrap } from "./invoice-connections";
import { invoiceDocumentSchema, invoiceLabel, type InvoiceDocument } from "../invoices";
import { createInvoice, getInvoice, mutateInvoice } from "./invoices";
import { invoicePaymentMethods } from "./invoice-payment-methods";
import { canManageBilling } from "../invoice-permissions";
import { getInvoiceDefaults } from "./invoice-defaults";
import { renderInvoicePdf } from "../invoice-pdf";
import { getViewerMailbox, mailboxHasSmtp } from "./mailboxes";
import { replyReferences, normalizeMessageId } from "../email-threading";
import { sendMailboxEmail } from "../mailer";
import { evaluateSend } from "../outreach-policy";
import { commerceDefaults } from "../company-commerce";
import { env } from "../env";
import type { InboxEmailItem } from "../email-inbox";

type Attachment = { filename: string; contentType: string; content: Buffer };

async function owner(row: AutoReplyRow): Promise<WorkspaceViewer> {
  const { data } = await createSupabaseAdmin().from("workspace_members").select("role,display_name,activated_at")
    .eq("user_id", row.user_id).maybeSingle().throwOnError();
  if (!data?.activated_at || data.role === "viewer") throw new Error("The automation owner is no longer an active sales user.");
  const viewer = { id: row.user_id, email: null, role: data.role, displayName: data.display_name } as WorkspaceViewer;
  await authorizeAutoReply(viewer, row);
  return viewer;
}

async function customer(row: AutoReplyRow) {
  const db = createSupabaseAdmin();
  const { data: contacts } = await db.from("contacts").select("id,company_id,name,email,unsubscribed,verification_status").eq("email", row.recipient).limit(2).throwOnError();
  if ((contacts?.length ?? 0) > 1) throw new Error("Multiple CRM contacts use this address. Resolve the customer before replying automatically.");
  const contact = contacts?.[0] ?? null;
  const { data: company } = contact ? await db.from("companies").select("id,name,country,city,segment").eq("id", contact.company_id).single().throwOnError() : { data: null };
  return { contact, company };
}

async function currentConversation(row: AutoReplyRow, sync = false) {
  const { mailbox, messages } = await mailboxHistory(row.mailbox_id, row.user_id, sync);
  const history = autoReplyConversation(mergeAutoReplyHistory(row.history, messages), row.anchors);
  return { mailbox, history, latest: latestCustomerMessage(history, row.recipient) };
}

async function handoff(row: AutoReplyRow, reason: string, history: InboxEmailItem[], document?: InvoiceDocument) {
  const { contact, company } = await customer(row);
  const latest = latestCustomerMessage(history, row.recipient);
  await createSupabaseAdmin().rpc("handoff_email_auto_reply", {
    p_id: row.id, p_revision: row.revision, p_status: document ? "waiting_shipping" : "needs_review",
    p_document: document ?? null, p_message_key: latest ? messageIdentity(latest) : row.last_message_key,
    p_history: history, p_reason: reason, p_company_id: company?.id ?? null, p_contact_id: contact?.id ?? null,
  }).throwOnError();
}

async function planReply(row: AutoReplyRow, history: InboxEmailItem[]) {
  const db = createSupabaseAdmin();
  const [profile, products, knowledge, bootstrap] = await Promise.all([
    customer(row), loadFlowReplyProducts({ useProducts: true }, row.user_id),
    db.from("email_reply_knowledge").select("title,content").order("created_at").throwOnError(),
    invoiceBootstrap({ userId: row.user_id, email: row.recipient, threadId: row.thread_key }),
  ]);
  const prompt = JSON.stringify({
    recipient: row.recipient, customer: profile.company, contactName: profile.contact?.name,
    savedBilling: bootstrap.document, savedDelivery: bootstrap.billing?.profile,
    conversation: history.map(({ direction, subject, body, timestamp, attachments }) => ({ direction, subject, body, timestamp,
      attachments: attachments?.map(({ filename }) => ({ filename, contentsAvailable: false })) })),
    products: products.map((product) => ({ ...invoiceProduct({ ...product, tags: product.tags ?? [] }), material: product.material, diameter: product.diameter,
      weight: product.weight, leadTime: product.lead_time })),
    approvedBusinessFacts: knowledge.data ?? [],
  });
  // Never silently discard early commitments or product/policy records.
  if (prompt.length > 300_000) throw new Error("The conversation or business context is too large for automatic review. A person must review this reply.");
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const token = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
  const options = { prompt, systemInstruction: autoReplyInstruction, maxOutputTokens: 8192 };
  const gateway = () => {
    if (!token) throw new Error("AI auto-reply is not configured.");
    return generateGatewayText({ ...options, token, model: process.env.AI_GATEWAY_EMAIL_MODEL?.trim() });
  };
  let output: string;
  try { output = apiKey ? await generateGeminiText({ ...options, apiKey, model: process.env.GEMINI_EMAIL_MODEL?.trim() }) : await gateway(); }
  catch (error) { if (!apiKey || !token || !isGeminiRegionError(error)) throw error; output = await gateway(); }
  const plan = autoReplyPlanSchema.parse(JSON.parse(output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
  if (plan.action === "reply" && plan.invoiceItems.length) throw new Error("Invoice requests must pause for shipping approval.");
  return { plan, products, profile, bootstrap };
}

async function catalogAttachment(row: AutoReplyRow, plan: AutoReplyPlan, context: Awaited<ReturnType<typeof planReply>>) {
  const { products, profile } = context;
  const requested = new Set(plan.catalogSkus);
  if ([...requested].some((sku) => !products.some((product) => product.sku === sku))) throw new Error("A catalog product is unavailable.");
  const db = createSupabaseAdmin();
  const { data: saved } = profile.company ? await db.from("catalogs").select("*").eq("user_id", row.user_id).eq("company_id", profile.company.id)
    .order("version", { ascending: false }).limit(1).maybeSingle().throwOnError() : { data: null };
  // Keep the customer's saved selection, but create a fresh version with the current
  // template and product photos. Previously issued quote PDFs remain unchanged.
  const selection = requested.size ? requested : saved ? new Set<string>(saved.product_skus ?? []) : null;
  if (selection && [...selection].some((sku) => !products.some((product) => product.sku === sku))) throw new Error("A catalog product is unavailable.");
  const selected = selection ? products.filter((product) => selection.has(product.sku)) : products;
  if (!selected.length) throw new Error("Add active products before sending a catalog.");
  // Save the actual selection in the customer's catalog history.
  if (profile.company) {
    const { data: versions } = await db.from("catalogs").select("version").eq("user_id", row.user_id).eq("company_id", profile.company.id)
      .order("version", { ascending: false }).limit(1).maybeSingle().throwOnError();
    const { data: catalog } = await db.from("catalogs").insert({
      user_id: row.user_id, product_snapshot: selected.map(crmProduct),
      company_id: profile.company.id, product_skus: selected.map((product) => product.sku),
      currency: selected[0].currency, version: (versions?.version ?? 0) + 1,
    }).select().single().throwOnError();
    return { filename: "Filazoo-customer-catalog.pdf", contentType: "application/pdf", content: Buffer.from(await ensureCompanyCatalogPdf({
      id: catalog.id, company: profile.company.name, productSkus: catalog.product_skus, currency: catalog.currency,
      priceDate: catalog.price_date, version: catalog.version, pdfUrl: catalog.pdf_url, createdAt: catalog.created_at,
    }, selected.map(crmProduct), row.user_id)) };
  }
  return { filename: "Filazoo-customer-catalog.pdf", contentType: "application/pdf",
    content: Buffer.from(await buildServerCatalogPdf(selected.map(crmProduct), { title: "Product catalog", customer: plan.billingName || row.recipient })) };
}

async function invoiceDocument(context: Awaited<ReturnType<typeof planReply>>) {
  const { plan, products, bootstrap } = context;
  if (!plan.invoiceItems.length) throw new Error("Confirm exact products, variants and quantities before preparing an invoice.");
  const { lines, currency } = replyInvoiceLines(plan.invoiceItems, products.map((product) => invoiceProduct({ ...product, tags: product.tags ?? [] })));
  const defaults = await getInvoiceDefaults();
  const saved = commerceDefaults(bootstrap.billing?.profile);
  const document = invoiceDocumentSchema.parse({
    ...bootstrap.document, customerName: plan.billingName || bootstrap.document.customerName,
    customerAddress: plan.billingAddress || bootstrap.document.customerAddress,
    shippingAddress: plan.shippingAddress || saved.shippingAddress || bootstrap.document.shippingAddress,
    shippingRecipient: plan.shippingRecipient || saved.shippingRecipient || bootstrap.document.shippingRecipient,
    shippingPhone: plan.shippingPhone || saved.shippingPhone || bootstrap.document.shippingPhone,
    currency, items: lines.map((line) => ({ ...line, taxBps: defaults.defaults.taxBps })), shippingMinor: 0,
    paymentMethods: (await invoicePaymentMethods()).filter((method) => !method.currency || method.currency === currency),
  });
  if (!document.customerName || !document.customerEmail || !document.customerAddress || !document.shippingAddress)
    throw new Error("Confirm the customer's billing name, billing address and full shipping address before invoicing.");
  return document;
}

async function checkCanSend(row: AutoReplyRow) {
  await owner(row);
  const db = createSupabaseAdmin();
  const { data } = await db.from("email_auto_replies").select("enabled,status,revision").eq("id", row.id).single().throwOnError();
  if (!data.enabled || data.status !== "processing" || data.revision !== row.revision) throw new Error("AI was stopped or changed before sending.");
  const { contact } = await customer(row);
  const [suppression, count] = await Promise.all([
    db.from("suppression").select("email", { count: "exact", head: true }).eq("email", row.recipient).throwOnError(),
    db.from("mailbox_sent_messages").select("id", { count: "exact", head: true }).eq("mailbox_id", row.sender_id)
      .gte("sent_at", `${new Date().toISOString().slice(0, 10)}T00:00:00Z`).throwOnError(),
  ]);
  const decision = evaluateSend({ email: row.recipient, verified: contact?.verification_status === "valid", inquiryResponse: true,
    unsubscribed: Boolean(contact?.unsubscribed), suppressed: Boolean(suppression.count), sentToday: count.count ?? 0,
    dailyLimit: env.DAILY_SEND_LIMIT, bounceRate: 0, bouncePausePercent: env.BOUNCE_PAUSE_PERCENT, dryRun: env.dryRun });
  if (!decision.allowed || decision.mode !== "send") throw new Error(decision.reason);
  const sender = await getViewerMailbox(row.user_id, row.sender_id);
  if (!sender || !mailboxHasSmtp(sender)) throw new Error("The selected sender is stopped or unavailable.");
  return sender;
}

async function deliver(row: AutoReplyRow, history: InboxEmailItem[], latest: InboxEmailItem, body: string, attachments: Attachment[], document?: InvoiceDocument) {
  const db = createSupabaseAdmin();
  await checkCanSend(row);
  const key = messageIdentity(latest);
  // Unique reservation prevents retries even after a process crashes following SMTP.
  const { data: delivery, error } = await db.from("email_auto_reply_deliveries").insert({ automation_id: row.id, message_key: key, status: "reserved" }).select().single();
  if (error) throw new Error(error.code === "23505" ? "This reply already has a delivery attempt. Review sent mail before sending manually." : error.message);
  try {
    if (document) {
      const { data: assignee } = await db.from("workspace_members").select("role").eq("user_id", row.assigned_to).not("activated_at", "is", null).maybeSingle().throwOnError();
      if (!assignee || !["admin", "operator", "bd_manager"].includes(assignee.role)) throw new Error("The assigned user cannot issue invoices.");
      await checkCanSend(row);
      let invoice = await getInvoice(delivery.id);
      if (!invoice) invoice = await createInvoice(invoiceDocumentSchema.parse(document), row.assigned_to, delivery.id);
      await db.from("email_auto_replies").update({ invoice_id: invoice.id }).eq("id", row.id).throwOnError();
      if (invoice.status !== "draft") throw new Error("This invoice was already issued. Review its delivery before sending again.");
      if (canManageBilling(assignee.role)) {
        invoice = await mutateInvoice(invoice.id, row.assigned_to, { action: "issue", revision: invoice.revision });
        if (!invoice) throw new Error("The invoice could not be issued.");
      }
      attachments.push({ filename: `${invoiceLabel(invoice)}.pdf`, contentType: "application/pdf", content: Buffer.from(await renderInvoicePdf(invoice, new Date().toISOString().slice(0, 10))) });
      body = `Hello ${document.shippingRecipient || document.customerName},\n\nPlease find your ${invoice.status === "draft" ? "draft invoice for review" : "invoice"} ${invoiceLabel(invoice)} attached, including the confirmed shipping cost. Please review the invoice and let us know if you have any questions.`;
    }
    if (attachments.some((attachment) => attachment.content.length > 7_500_000)) throw new Error("An attachment exceeds 7.5 MB.");
    const { data: manager } = await db.from("workspace_members").select("display_name").eq("user_id", row.assigned_to).single().throwOnError();
    body = applyEmailSignature(body, { name: manager.display_name || "Filazoo Sales Team", title: DEFAULT_EMAIL_TITLE, company: DEFAULT_EMAIL_COMPANY }, "en");
    const emailContent = await prepareUserEmail(row.user_id, { text: body, attachments });
    body = emailContent.text;
    attachments = emailContent.attachments as Attachment[];
    const subject = `Re: ${latest.subject.replace(/^(re:\s*)+/i, "")}`.replace(/[\r\n]/g, " ").slice(0, 300);
    const references = replyReferences(latest);
    const sentId = randomUUID();
    const stored = [];
    for (const [index, attachment] of attachments.entries()) {
      const path = `${row.user_id}/${sentId}/${index}`;
      await db.storage.from("mailbox-attachments").upload(path, attachment.content, { contentType: attachment.contentType, upsert: false }).then(({ error }) => { if (error) throw error; });
      stored.push({ filename: attachment.filename, contentType: attachment.contentType, size: attachment.content.length, path, ...( "cid" in attachment ? { cid: attachment.cid } : {}) });
    }
    const fresh = await currentConversation(row, true);
    if (!fresh.latest || messageIdentity(fresh.latest) !== key) throw new Error("A newer customer message arrived. Review before replying.");
    const sender = await checkCanSend(row);
    const sent = await sendMailboxEmail({ host: sender.smtpHost, port: sender.smtpPort, user: sender.smtpUsername, pass: sender.smtpPassword, from: sender.email }, {
      to: row.recipient, subject, text: body, html: emailContent.html, inReplyTo: latest.messageId || undefined, references, attachments,
    });
    const sentAt = new Date().toISOString();
    await db.from("mailbox_sent_messages").insert({
      id: sentId, user_id: row.user_id, mailbox_id: row.sender_id, from_email: sender.email, to_email: row.recipient,
      message_id: sent.messageId, thread_key: row.thread_key, in_reply_to: latest.messageId, reference_ids: references,
      subject, body, body_html: emailContent.html || null, status: "sent", sent_at: sentAt, attachments: stored,
    }).throwOnError();
    await db.from("email_auto_reply_deliveries").update({ status: "sent", message_id: sent.messageId, sent_at: sentAt }).eq("id", delivery.id).throwOnError();
    const sentMessage: InboxEmailItem = { id: `sent-${sentId}`, direction: "outbound", contact: row.recipient, subject, body, timestamp: sentAt,
      messageId: sent.messageId, threadId: row.thread_key, inReplyTo: latest.messageId, references, bodyLoaded: true, status: "Sent", company: "", preview: "" };
    await db.from("email_auto_replies").update({ status: "active", last_message_key: key, last_sent_at: sentAt, last_error: null,
      history: mergeAutoReplyHistory(history, [sentMessage]), anchors: [...new Set([...row.anchors, normalizeMessageId(sent.messageId)!])],
      pending_document: null, pending_message_key: null, processing_at: null,
    }).eq("id", row.id).eq("revision", row.revision).eq("enabled", true).throwOnError();
    if (row.task_id) await db.from("crm_tasks").update({ status: "done", completed_at: sentAt }).eq("id", row.task_id).eq("status", "open").throwOnError();
  } catch (cause) {
    await db.from("email_auto_reply_deliveries").update({ status: "failed", error: cause instanceof Error ? cause.message : "Delivery interrupted" }).eq("id", delivery.id).neq("status", "sent").throwOnError();
    throw cause;
  }
}

export async function processEmailAutoReply(id: string) {
  const db = createSupabaseAdmin();
  const { data: before } = await db.from("email_auto_replies").select("*").eq("id", id).eq("enabled", true).in("status", ["active", "ready", "waiting_shipping"]).maybeSingle().throwOnError();
  if (!before) return;
  const row = before as AutoReplyRow;
  // Do not change a shipping form's revision just because a poll found no mail.
  let snapshot: Awaited<ReturnType<typeof currentConversation>>;
  try { snapshot = await currentConversation(row); }
  catch (cause) {
    await db.from("email_auto_replies").update({ status: "needs_review", last_error: cause instanceof Error ? cause.message : "Receiving mailbox unavailable." })
      .eq("id", id).eq("revision", row.revision).eq("enabled", true).throwOnError();
    return;
  }
  if (row.status === "waiting_shipping" && snapshot.latest && messageIdentity(snapshot.latest) === row.pending_message_key) {
    // Rotate idle handoffs behind other due conversations without invalidating approval.
    await db.from("email_auto_replies").update({ updated_at: new Date().toISOString() }).eq("id", id)
      .eq("status", "waiting_shipping").eq("revision", row.revision).eq("enabled", true).throwOnError();
    return;
  }
  const { data: claimed } = await db.from("email_auto_replies").update({ status: "processing", processing_at: new Date().toISOString(), revision: row.revision + 1 })
    .eq("id", id).eq("status", row.status).eq("revision", row.revision).eq("enabled", true).select("id").maybeSingle().throwOnError();
  if (!claimed) return;
  row.revision += 1;
  let history = row.history;
  try {
    await owner(row);
    const current = snapshot;
    history = await hydrateAutoReplyHistory(current.mailbox, current.history);
    const latest = latestCustomerMessage(history, row.recipient);
    if (!latest) throw new Error("Customer message unavailable.");
    const latestInbound = [...history].reverse().find((message) => message.direction === "inbound");
    if (latestInbound && messageIdentity(latestInbound) !== messageIdentity(latest)) throw new Error("The conversation includes another sender. Review its destination before replying.");
    if (row.status === "waiting_shipping" && messageIdentity(latest) === row.pending_message_key) {
      await db.from("email_auto_replies").update({ status: "waiting_shipping", processing_at: null }).eq("id", id).eq("revision", row.revision).eq("status", "processing").throwOnError();
      return;
    }
    if (row.status === "ready") {
      if (messageIdentity(latest) !== row.pending_message_key) throw new Error("Customer details changed after shipping approval. Review before issuing an invoice.");
      await deliver(row, history, latest, "", [], invoiceDocumentSchema.parse(row.pending_document));
      return;
    }
    if (messageIdentity(latest) === row.last_message_key || Date.parse(latest.timestamp) <= Date.parse(row.enabled_at)) {
      await db.from("email_auto_replies").update({ status: "active", processing_at: null }).eq("id", id).eq("revision", row.revision).eq("status", "processing").throwOnError();
      return;
    }
    const newerManualReply = history.some((message) => message.direction === "outbound" && Date.parse(message.timestamp) > Date.parse(latest.timestamp));
    if (newerManualReply) throw new Error("A teammate already replied. Review before resuming AI.");
    if (latest.automaticResponse || /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i.test(latest.contact)) throw new Error("Automatic or system message detected. No reply sent.");
    const context = await planReply(row, history);
    if (context.plan.action === "review") { await handoff(row, context.plan.reason || "The customer needs a person to review this request.", history); return; }
    if (context.plan.action === "invoice") {
      const document = await invoiceDocument(context);
      const totalQuantity = document.items.reduce((sum, item) => sum + item.quantity, 0);
      await handoff(row, `Confirm shipping cost in ${document.currency} for ${totalQuantity} units to:\n${document.shippingRecipient || document.customerName}\n${document.shippingAddress}\n${document.shippingPhone || ""}\nNo customer reply has been sent.`, history, document);
      return;
    }
    const attachments = context.plan.attachCatalog ? [await catalogAttachment(row, context.plan, context)] : [];
    await deliver(row, history, latest, context.plan.body, attachments);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "Unable to prepare the reply. Review this conversation.";
    // Preserve a manual stop. A failure must never re-enable the automation.
    const { data: stillCurrent } = await db.from("email_auto_replies").select("id").eq("id", id).eq("revision", row.revision).eq("status", "processing").eq("enabled", true).maybeSingle().throwOnError();
    if (stillCurrent) {
      try { await handoff(row, reason, history); }
      catch { await db.from("email_auto_replies").update({ status: "needs_review", last_error: reason, processing_at: null }).eq("id", id).eq("revision", row.revision).eq("status", "processing").throwOnError(); }
    }
  }
}

export async function processEmailAutoReplies(mailboxId?: string) {
  const db = createSupabaseAdmin();
  const { error: schemaError } = await db.from("email_auto_replies").select("id").limit(1);
  if (isAutoReplySchemaMissing(schemaError)) return 0;
  if (schemaError) throw schemaError;
  // Abandoned workers are never automatically retried after an uncertain send.
  let stale = db.from("email_auto_replies").select("*").eq("status", "processing").eq("enabled", true)
    .lt("processing_at", new Date(Date.now() - 10 * 60_000).toISOString());
  if (mailboxId) stale = stale.eq("mailbox_id", mailboxId);
  for (const row of (await stale.throwOnError()).data ?? []) {
    try { await handoff(row as AutoReplyRow, "Execution was interrupted. Check sent mail and invoices before resuming AI.", row.history); } catch { /* A concurrent manual action takes precedence. */ }
  }
  let query = db.from("email_auto_replies").select("id").eq("enabled", true).in("status", ["active", "ready", "waiting_shipping"]).order("updated_at").limit(10);
  if (mailboxId) query = query.eq("mailbox_id", mailboxId);
  const { data } = await query.throwOnError();
  const startedAt = Date.now();
  let checked = 0;
  for (const row of data ?? []) {
    if (Date.now() - startedAt > 120_000) break;
    try { await processEmailAutoReply(row.id); }
    catch (error) { console.warn("Conversation AI auto-reply check failed:", error instanceof Error ? error.message : "Unknown error"); }
    checked += 1;
  }
  return checked;
}
