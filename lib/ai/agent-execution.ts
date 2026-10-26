import "server-only";
import { revalidatePath } from "next/cache";
import { createCompany, updateCompany, addCompanyComment } from "@/app/crm-actions";
import { POST as sendEmail } from "@/app/api/email/send/route";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { createInvoice, getInvoice, mutateInvoice } from "../data/invoices";
import { invoiceBootstrap, invoiceProducts, validateInvoiceConnections } from "../data/invoice-connections";
import { invoiceBankAccounts } from "../data/invoice-banks";
import { getEffectiveMailbox, mailboxHasSmtp } from "../data/mailboxes";
import { canEditInvoice } from "../invoice-permissions";
import { invoiceLabel, invoiceTotals, type InvoiceDocument } from "../invoices";
import { buildAgentInvoice, type AgentProposal, type PreparedAgentAction } from "./agent-actions";
import type { WorkspaceAction } from "./workspace-assistant";
import { actionWorkProgress, type AgentWorkProgress } from "./agent-progress";
import { loadAgentCompany, loadAgentEmails, prepareAgentEmail } from "./agent-records";
import { threadKeyForEmail } from "../email-threading";

export async function prepareAgentActions(actions: WorkspaceAction[], viewer: WorkspaceViewer, approvalMode: "ask" | "auto") {
  if (viewer.role === "viewer") throw new Error("Your workspace role is read-only.");
  const proposals: AgentProposal[] = [];
  for (const action of actions) {
    let prepared: PreparedAgentAction;
    if (action.type === "create_company") prepared = action;
    else if (action.type === "update_company" || action.type === "add_company_note") {
      const company = await loadAgentCompany(action.companyId);
      prepared = action.type === "update_company" ? { ...action, companyName: company.fields.name, fingerprint: company.fingerprint } : { ...action, companyName: company.fields.name };
    } else if (action.type === "write_email" && !action.invoiceId) {
      if (action.email.delivery !== "draft" && !mailboxHasSmtp(await getEffectiveMailbox(viewer.id))) throw new Error("Connect an active SMTP mailbox in Settings before sending email.");
      prepared = { type: action.type, email: await prepareAgentEmail(action.email, viewer) };
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
        prepared = { type: "send_invoice", invoiceId: existing.id, email: await prepareAgentEmail(action.email, viewer), revision: existing.revision, document: existing.document };
      } else if (action.type === "create_invoice" || action.type === "update_invoice") {
        if (existing && existing.document.companyId !== action.companyId) throw new Error("The invoice belongs to a different company. Open that company to create a new invoice.");
        if (existing?.document.purchaseOrderId) throw new Error("Update this order-linked invoice in its editor to preserve the agreed order pricing.");
        if (existing?.document.items.some((item) => !item.productSku || item.pricingMode !== "catalog")) throw new Error("This invoice contains custom or agreed pricing. Update it in the invoice editor to preserve those prices.");
        const sourceEmailId = action.sourceEmailId || action.email?.sourceEmailId;
        const source = sourceEmailId ? await loadAgentEmails(viewer, sourceEmailId) : null;
        if (source && source.companyId !== action.companyId) throw new Error("The email does not match this customer uniquely. Choose the correct customer before creating its invoice.");
        const skus = [...new Set(action.items.map((item) => item.productSku))];
        const [bootstrap, catalog, banks] = await Promise.all([
          invoiceBootstrap({ companyId: action.companyId, ...(source?.current ? { email: source.current.contact, threadId: threadKeyForEmail(source.current) } : {}) }),
          invoiceProducts("", 0, "", skus),
          invoiceBankAccounts(),
        ]);
        const base = existing?.document ?? bootstrap.document;
        const document = buildAgentInvoice(base, action, catalog.products, banks);
        await validateInvoiceConnections(document);
        prepared = action.type === "create_invoice"
          ? { type: action.type, document, ...(action.email ? { email: await prepareAgentEmail(action.email, viewer) } : {}) }
          : { type: action.type, invoiceId: action.invoiceId, revision: existing!.revision, document, ...(action.email ? { email: await prepareAgentEmail(action.email, viewer) } : {}) };
      } else throw new Error("Invalid invoice action.");
    }
    proposals.push({ id: crypto.randomUUID(), action: prepared, approvalMode, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });
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
  if (!document.bankAccountId) return;
  const bank = (await invoiceBankAccounts()).find((account) => account.id === document.bankAccountId);
  if (!bank || JSON.stringify(bank) !== JSON.stringify(document.bankAccount)) throw new Error("The selected bank details changed. Ask the agent to prepare a fresh proposal.");
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
  if (action.type === "create_company") {
    await reportProgress(activity);
    const data = new FormData();
    Object.entries(action.company).forEach(([key, value]) => data.set(key, value));
    const result = await createCompany(undefined, data);
    if (result?.error) throw new Error(result.error);
    return { success: result?.success || `${action.company.name} was added.`, href: "/companies" };
  }
  if (action.type === "update_company" || action.type === "add_company_note") {
    await reportProgress(activity);
    const company = await loadAgentCompany(action.companyId);
    const data = new FormData();
    if (action.type === "add_company_note") data.set("comment", action.note);
    else {
      if (company.fingerprint !== action.fingerprint) throw new Error("This customer profile changed after the proposal. Ask the agent to prepare it again.");
      Object.entries(company.fields).forEach(([key, value]) => data.set(key, value));
      Object.entries(action.changes).forEach(([key, value]) => {
        if (key === "commerce") Object.entries(value).forEach(([field, text]) => data.set(`commerce.${field}`, String(text)));
        else data.set(key, String(value));
      });
    }
    const result = action.type === "add_company_note" ? await addCompanyComment(action.companyId, undefined, data) : await updateCompany(action.companyId, undefined, data);
    if (result?.error) throw new Error(result.error);
    return { success: result?.success || "Customer profile updated.", companyId: action.companyId, href: `/companies/${action.companyId}` };
  }
  if (action.type === "write_email") {
    await reportProgress(activity);
    if (action.email.delivery === "draft") return { success: "Email draft prepared in the inbox composer.", href: `/emails?agentDraft=${id}`, draft: { ...action.email } };
    await prepareAgentEmail(action.email, viewer);
    const response = await sendEmail(new Request(new URL("/api/email/send", request.url), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action.email) }));
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Email was not confirmed sent. Check Sent before retrying.");
    revalidatePath("/emails");
    return { success: `Email sent to ${action.email.to}.${result.saved === false ? " The mailbox accepted it, but the Sent record could not be saved." : ""}`, href: "/emails" };
  }
  await reportProgress({ ...activity, label: "Checking invoice details…" });
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
    ...saved, success: `${saved.success} Email draft prepared with its invoice PDF.`, href: `/emails?agentDraft=${id}`,
    draft: { ...action.email, invoiceId: invoice.id, revision: invoice.revision },
  };
  await reportProgress({ area: "invoice", label: "Preparing invoice PDF…", detail: `${invoiceLabel(invoice)} · ${invoice.document.customerName}`, relatedAreas: ["email"] });
  const { renderInvoicePdf } = await import("../invoice-pdf");
  const { invoicePdfFilename } = await import("../invoice-pdf-meta");
  const pdf = await renderInvoicePdf(invoice, new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()));
  await reportProgress({ area: "email", label: "Sending invoice email…", detail: `${invoiceLabel(invoice)} · ${action.email.to}`, relatedAreas: ["invoice"] });
  const response = await sendEmail(new Request(new URL("/api/email/send", request.url), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...action.email, attachments: [{ filename: invoicePdfFilename(invoice), contentType: "application/pdf", content: pdf.toString("base64") }] }),
  }));
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(`${saved.success} Email was not confirmed sent: ${result.error || "Mailbox request failed."} Check Sent before preparing another send.`);
  revalidatePath("/emails");
  return { ...saved, success: `${invoiceLabel(invoice)} sent to ${action.email.to} with its PDF attached.${result.saved === false ? " The mailbox accepted it, but the Sent record could not be saved." : ""}` };
}
