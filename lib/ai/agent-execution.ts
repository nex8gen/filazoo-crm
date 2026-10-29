import "server-only";
import { revalidatePath } from "next/cache";
import { createCompany, updateCompanyFields, addCompanyComment } from "@/app/crm-actions";
import { POST as sendEmail } from "@/app/api/email/send/route";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { createInvoice, getInvoice, mutateInvoice } from "../data/invoices";
import { invoiceBootstrap, invoiceProducts, validateInvoiceConnections } from "../data/invoice-connections";
import { invoiceBankAccounts } from "../data/invoice-banks";
import { invoicePaymentMethods } from "../data/invoice-payment-methods";
import { createFlow } from "../data/flows";
import { flowInputSchema } from "../flows";
import { getEffectiveMailbox, getViewerMailbox, mailboxHasSmtp } from "../data/mailboxes";
import { canEditInvoice } from "../invoice-permissions";
import { invoiceLabel, invoiceTotals, type InvoiceDocument } from "../invoices";
import { buildAgentInvoice, groundInvoiceVariant, groundInvoiceEmailIntent, type AgentPlanningContext, type AgentProposal, type PreparedAgentAction } from "./agent-actions";
import type { WorkspaceAction } from "./workspace-assistant";
import { actionWorkProgress, type AgentWorkProgress } from "./agent-progress";
import { loadAgentCompany, loadAgentEmails, prepareAgentEmail } from "./agent-records";
import { threadKeyForEmail } from "../email-threading";
import { prepareCrmAction, executeCrmAction } from "./crm-execution";
import { crmManualApproval } from "./crm-tools";
import { deriveCompanyAddressFields } from "../company-profile-fields";
import { prepareAgentCatalog, agentCatalogAttachments } from "./agent-catalog";

async function validateCustomerEmailSource(action: { companyId: string; sourceEmailId?: string }, viewer: WorkspaceViewer) {
  if (!action.sourceEmailId) return;
  const source = await loadAgentEmails(viewer, action.sourceEmailId);
  if (source.companyId !== action.companyId || source.current?.direction !== "inbound") {
    throw new Error("The source email does not uniquely match this customer. Choose the correct customer conversation before updating its profile.");
  }
}

export async function prepareAgentActions(actions: WorkspaceAction[], viewer: WorkspaceViewer, approvalMode: "ask" | "auto", context?: AgentPlanningContext) {
  if (viewer.role === "viewer" && (!actions.length || actions.some((action) => action.type !== "crm_action" || !["update_product", "create_catalog"].includes(action.operation.op)))) throw new Error("Your workspace role is read-only outside your private product catalog.");
  const proposals: AgentProposal[] = [];
  for (const candidate of actions) {
    const action = groundInvoiceEmailIntent(candidate, context);
    let prepared: PreparedAgentAction;
    if (action.type === "crm_action") prepared = await prepareCrmAction(action.operation, viewer);
    else if (action.type === "create_company" || action.type === "create_flow") prepared = action;
    else if (action.type === "update_company" || action.type === "add_company_note") {
      await validateCustomerEmailSource(action, viewer);
      const company = await loadAgentCompany(action.companyId);
      prepared = action.type === "update_company" ? { ...action, changes: action.deriveAddressFields ? deriveCompanyAddressFields(action.changes, company.fields) : action.changes, companyName: company.fields.name, fingerprint: company.fingerprint } : { ...action, companyName: company.fields.name };
    } else if (action.type === "write_email" && !action.invoiceId) {
      const email = await prepareAgentCatalog(await prepareAgentEmail(action.email, viewer));
      if (action.email.delivery !== "draft") {
        const mailbox = "mailboxId" in email ? await getViewerMailbox(viewer.id, email.mailboxId as string) : await getEffectiveMailbox(viewer.id);
        if (!mailboxHasSmtp(mailbox)) throw new Error("Connect an active SMTP mailbox in Settings before sending email.");
      }
      prepared = { type: action.type, email };
    }
    else {
      const existing = action.type === "create_invoice" ? null : action.invoiceId ? await getInvoice(action.invoiceId) : null;
      if (action.type !== "create_invoice" && !existing) throw new Error("The selected invoice no longer exists.");
      if (existing?.status === "void") throw new Error("A void invoice cannot be updated or sent.");
      if (action.type === "update_invoice" && existing && !canEditInvoice(viewer, existing)) throw new Error("You can only update draft invoices permitted by your workspace role.");
      if (action.email && action.email.delivery !== "draft") {
        const mailbox = await getEffectiveMailbox(viewer.id);
        if (!mailboxHasSmtp(mailbox)) throw new Error("Connect an active SMTP mailbox in Settings before sending an invoice.");
      }
      if ((action.type === "send_invoice" || action.type === "write_email") && existing) {
        prepared = { type: "send_invoice", invoiceId: existing.id, email: await prepareAgentCatalog(await prepareAgentEmail(action.email, viewer)), revision: existing.revision, document: existing.document };
      } else if (action.type === "create_invoice" || action.type === "update_invoice") {
        if (existing && existing.document.companyId !== action.companyId) throw new Error("The invoice belongs to a different company. Open that company to create a new invoice.");
        if (action.items && existing?.document.purchaseOrderId) throw new Error("Update this order-linked invoice's products in its editor to preserve the agreed order pricing.");
        if (action.items && existing?.document.items.some((item) => !item.productSku || item.pricingMode !== "catalog")) throw new Error("This invoice contains custom or agreed pricing. Omit items to update its details, or change products in the invoice editor to preserve those prices.");
        const sourceEmailId = action.sourceEmailId || action.email?.sourceEmailId;
        const source = sourceEmailId ? await loadAgentEmails(viewer, sourceEmailId) : null;
        if (source && source.companyId !== action.companyId) throw new Error("The email does not match this customer uniquely. Choose the correct customer before creating its invoice.");
        const skus = [...new Set(action.items?.map((item) => item.productSku) ?? [])];
        const [bootstrap, catalog, banks, payments] = await Promise.all([
          invoiceBootstrap({ companyId: action.companyId, ...(source?.current ? { email: source.current.contact, threadId: threadKeyForEmail(source.current) } : {}) }),
          skus.length ? invoiceProducts("", 0, "", skus) : Promise.resolve({ products: [] }),
          invoiceBankAccounts(),
          invoicePaymentMethods(),
        ]);
        const base = existing?.document ?? bootstrap.document;
        const document = buildAgentInvoice(base, groundInvoiceVariant(action, catalog.products, context), catalog.products, banks, payments, { creating: action.type === "create_invoice" });
        await validateInvoiceConnections(document);
        prepared = action.type === "create_invoice"
          ? { type: action.type, document, ...(action.email ? { email: await prepareAgentCatalog(await prepareAgentEmail(action.email, viewer)) } : {}) }
          : { type: action.type, invoiceId: action.invoiceId, revision: existing!.revision, document, ...(action.email ? { email: await prepareAgentCatalog(await prepareAgentEmail(action.email, viewer)) } : {}) };
      } else throw new Error("Invalid invoice action.");
    }
    proposals.push({ id: crypto.randomUUID(), action: prepared, approvalMode: action.type === "crm_action" && crmManualApproval(action.operation) ? "ask" : approvalMode, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });
  }
  if (proposals.length) {
    const { error } = await createSupabaseAdmin().from("workspace_agent_actions").insert(proposals.map((proposal) => ({
      id: proposal.id, user_id: viewer.id, action: proposal.action, approval_mode: proposal.approvalMode, expires_at: proposal.expiresAt,
    })));
    if (error) throw new Error("Unable to save the action for approval. Check the workspace_agent_actions database migration.");
  }
  return proposals;
}

async function validateSavedBank(document: InvoiceDocument) {
  if (document.bankAccountId) {
    const bank = (await invoiceBankAccounts()).find((account) => account.id === document.bankAccountId);
    if (!bank || JSON.stringify(bank) !== JSON.stringify(document.bankAccount)) throw new Error("The selected bank details changed. Ask the agent to prepare a fresh proposal.");
  }
  if (document.paymentMethods?.length) {
    const current = await invoicePaymentMethods();
    for (const method of document.paymentMethods) {
      if (JSON.stringify(current.find((value) => value.id === method.id)) !== JSON.stringify(method)) throw new Error("The selected payment details changed. Ask the agent to prepare a fresh proposal.");
    }
  }
}

/** The caller has atomically claimed this stored proposal; never retry SMTP implicitly. */
export async function executeAgentAction(id: string, action: PreparedAgentAction, viewer: WorkspaceViewer, request: Request) {
  const db = createSupabaseAdmin();
  const activity = actionWorkProgress(action);
  let savedResult: Record<string, unknown> = {};
  async function reportProgress(progress: AgentWorkProgress) {
    const { error } = await db.from("workspace_agent_actions").update({ result: { ...savedResult, progress } }).eq("id", id).eq("user_id", viewer.id).eq("status", "running");
    if (error) throw new Error("Unable to record action progress. Check the action result before retrying.");
  }
  if (action.type === "crm_action") {
    await reportProgress(activity);
    return executeCrmAction(action, viewer, id, request);
  }
  if (action.type === "create_flow") {
    await reportProgress(activity);
    const flow = await createFlow(viewer.id, flowInputSchema.parse(action.flow));
    revalidatePath("/lead-channel/ai-agent");
    return { success: `${flow.name} created as ${flow.status === "live" ? "a live flow" : "a draft flow"}.`, flowId: flow.id, href: `/lead-channel/ai-agent?flow=${flow.id}` };
  }
  if (action.type === "create_company") {
    await reportProgress(activity);
    const data = new FormData();
    Object.entries(action.company).forEach(([key, value]) => data.set(key, value));
    const result = await createCompany(undefined, data);
    if (result?.error) throw new Error(result.error);
    if (!result?.success) throw new Error("The CRM did not confirm company creation. Check Companies before retrying.");
    return { success: result.success, ...(result.companyId ? { companyId: result.companyId } : {}), href: result.companyId ? `/companies/${result.companyId}` : "/companies" };
  }
  if (action.type === "update_company" || action.type === "add_company_note") {
    await reportProgress(activity);
    await validateCustomerEmailSource(action, viewer);
    const company = await loadAgentCompany(action.companyId);
    const data = new FormData();
    if (action.type === "add_company_note") data.set("comment", action.note);
    else {
      if (company.fingerprint !== action.fingerprint) throw new Error("This customer profile changed after the proposal. Ask the agent to prepare it again.");
    }
    const result = action.type === "add_company_note" ? await addCompanyComment(action.companyId, undefined, data) : await updateCompanyFields(action.companyId, action.changes);
    if (result?.error) throw new Error(result.error);
    return { success: result?.success || "Customer profile updated.", companyId: action.companyId, href: `/companies/${action.companyId}` };
  }
  if (action.type === "write_email") {
    await reportProgress(activity);
    const email = await prepareAgentEmail(action.email, viewer);
    const attachments = await agentCatalogAttachments(action.email);
    if (email.delivery === "draft") return { success: `Email draft prepared${attachments.length ? " with its catalog PDF" : ""} in the inbox composer.`, href: `/emails?agentDraft=${id}`, draft: { ...email, ...(action.email.catalogSnapshot ? { catalogSnapshot: action.email.catalogSnapshot } : {}) } };
    const response = await sendEmail(new Request(new URL("/api/email/send", request.url), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...email, attachments }) }));
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Email was not confirmed sent. Check Sent before retrying.");
    revalidatePath("/emails");
    return { success: `Email sent to ${action.email.to}.${result.saved === false ? " The mailbox accepted it, but the Sent record could not be saved." : ""}`, href: "/emails" };
  }
  await reportProgress({ ...activity, label: "Checking invoice details…" });
  // Validate and render attachments before creating/updating an invoice.
  const catalogAttachments = action.email ? await agentCatalogAttachments(action.email) : [];
  let invoice = action.type === "create_invoice" ? null : await getInvoice(action.invoiceId);
  if (action.type !== "create_invoice" && (!invoice || invoice.revision !== action.revision || invoice.status === "void")) throw new Error("This invoice changed after the proposal. Ask the agent to prepare it again.");
  if (action.type === "update_invoice" && invoice && !canEditInvoice(viewer, invoice)) throw new Error("You no longer have permission to edit this invoice.");
  if (action.type !== "send_invoice") {
    await validateSavedBank(action.document);
    await validateInvoiceConnections(action.document);
    await reportProgress(activity);
    invoice = action.type === "create_invoice"
      ? await createInvoice(action.document, viewer.id, id)
      : await mutateInvoice(action.invoiceId, viewer.id, { action: "save", revision: action.revision, document: action.document, totalMinor: invoiceTotals(action.document).total });
  }
  if (!invoice) throw new Error("Unable to read the saved invoice. Check Invoices before starting another task.");
  const href = `/invoices/${invoice.id}`;
  const saved = { invoiceId: invoice.id, href, success: `${invoiceLabel(invoice)} ${action.type === "send_invoice" ? "ready" : action.type === "create_invoice" ? "created as a draft" : "updated"}.` };
  savedResult = saved;
  // Checkpoint creation before attempting email, so a mail error still links to the saved invoice.
  const checkpoint = await db.from("workspace_agent_actions").update({ result: saved }).eq("id", id).eq("user_id", viewer.id);
  if (checkpoint.error) throw new Error(`The invoice was saved at ${href}, but its action result could not be recorded. Check Invoices before retrying.`);
  revalidatePath("/invoices");
  revalidatePath(href);
  if (invoice.document.companyId) revalidatePath(`/companies/${invoice.document.companyId}`);
  if (!action.email) return saved;
  // Recheck access to the source conversation at execution time.
  await prepareAgentEmail(action.email, viewer);
  if (action.email.delivery === "draft") return {
    ...saved, success: `${saved.success} Email draft prepared with its invoice PDF${catalogAttachments.length ? " and catalog PDF" : ""}.`, href: `/emails?agentDraft=${id}`,
    draft: { ...action.email, invoiceId: invoice.id, revision: invoice.revision },
  };
  await reportProgress({ area: "invoice", label: "Preparing invoice PDF…", detail: `${invoiceLabel(invoice)} · ${invoice.document.customerName}`, relatedAreas: ["email"] });
  const { renderInvoicePdf } = await import("../invoice-pdf");
  const { invoicePdfFilename } = await import("../invoice-pdf-meta");
  const pdf = await renderInvoicePdf(invoice, new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()));
  await reportProgress({ area: "email", label: "Sending invoice email…", detail: `${invoiceLabel(invoice)} · ${action.email.to}`, relatedAreas: ["invoice"] });
  const response = await sendEmail(new Request(new URL("/api/email/send", request.url), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...action.email, attachments: [{ filename: invoicePdfFilename(invoice), contentType: "application/pdf", content: pdf.toString("base64") }, ...catalogAttachments] }),
  }));
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(`${saved.success} Email was not confirmed sent: ${result.error || "Mailbox request failed."} Check Sent before preparing another send.`);
  revalidatePath("/emails");
  return { ...saved, success: `${invoiceLabel(invoice)} sent to ${action.email.to} with its PDF attached.${result.saved === false ? " The mailbox accepted it, but the Sent record could not be saved." : ""}` };
}
