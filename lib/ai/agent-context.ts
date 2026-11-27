import "server-only";
import { getAiSettings } from "../data/ai-settings";
import { restrictedAiContext } from "../ai-policy";
import { z } from "zod";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { invoiceBootstrap, invoiceCustomers } from "../data/invoice-connections";
import { invoiceBankAccounts } from "../data/invoice-banks";
import { invoicePaymentMethods } from "../data/invoice-payment-methods";
import { getInvoice } from "../data/invoices";
import { getEffectiveMailbox, mailboxHasSmtp } from "../data/mailboxes";
import { invoiceProduct, type InvoiceProductRow } from "../invoice-links";
import type { WorkspaceAssistantInput } from "./workspace-assistant";
import { loadAgentCompany, loadAgentEmails, presentAgentEmail } from "./agent-records";
import { threadKeyForEmail } from "../email-threading";
import { flowAgentCapabilities } from "../flows";
import { loadAgentConversation, loadAgentFlow } from "./agent-page-records";
import { userProductRows } from "../data/product-personalization";
import { assertAiCustomerAccess, assignedAiCustomerIds, referencedCompanyIds } from "./customer-access.ts";

export { searchAgentEmails } from "./agent-records";

export async function loadAgentContext(input: WorkspaceAssistantInput, viewer: WorkspaceViewer) {
  const { policy } = await getAiSettings();
  const allowed = policy.data;
  const db = createSupabaseAdmin();
  const assigned = allowed.customers ? await assignedAiCustomerIds(viewer, db) : viewer.role === "admin" ? null : [];
  const contextWarnings: string[] = [];
  async function optional<T>(label: string, read: () => PromiseLike<T>, fallback: T): Promise<T> {
    try { return await read(); } catch { contextWarnings.push(`${label} unavailable. Do not infer missing facts; look up required records before acting.`); return fallback; }
  }
  const invoiceMatch = /^\/invoices\/([^/?]+)/.exec(input.pathname)?.[1];
  const quotationMatch = /^\/company-quotations\/([^/?]+)/.exec(input.pathname)?.[1];
  let currentQuotation = allowed.billing && allowed.customers && allowed.products && z.uuid().safeParse(quotationMatch).success
    ? await optional("Selected quotation", async () => (await import("../data/quotations")).quotationDetail(quotationMatch!, viewer), null) : null;
  const companyMatch = /^\/companies\/([^/?]+)/.exec(input.pathname)?.[1];
  const pageInvoiceId = input.pageContext?.invoiceId || (z.uuid().safeParse(invoiceMatch).success ? invoiceMatch : undefined);
  let companyId = input.pageContext?.companyId || (z.uuid().safeParse(companyMatch).success ? companyMatch : undefined);
  companyId ||= currentQuotation?.catalog.company_id;
  if (allowed.customers && companyId) await assertAiCustomerAccess(viewer, companyId, db);
  const emailContext = allowed.emails && allowed.customers && input.pageContext?.emailId ? await loadAgentEmails(viewer, input.pageContext.emailId, undefined, input.pageContext.mailboxId) : null;
  const currentConversation = allowed.emails && input.pageContext?.conversationId ? await loadAgentConversation(input.pageContext.conversationId, viewer) : null;
  const currentFlow = allowed.flows && allowed.emails && allowed.team && input.pageContext?.flowId ? await loadAgentFlow(input.pageContext.flowId, viewer) : null;
  const workflowAnalyticsPromise = viewer.role === "admin" && input.pathname === "/workflow/analytics" && allowed.flows && allowed.emails && allowed.team && policy.features.pageContext && !restrictedAiContext(policy)
    ? optional("Workflow analytics", async () => (await import("./agent-flow-analytics")).loadAgentWorkflowAnalytics(input.pageContext?.flowAnalytics), null) : Promise.resolve(null);
  if (emailContext) companyId = emailContext.companyId || undefined;
  const history = !restrictedAiContext(policy) && input.completedActionIds.length
    ? await db.from("workspace_agent_actions").select("id,status,result,action").eq("user_id", viewer.id).in("status", ["completed", "failed", "running"]).in("id", input.completedActionIds)
    : { data: [], error: null };
  if (history.error) throw new Error("Unable to read previous agent results.");
  const completed = input.completedActionIds.flatMap((id) => (history.data ?? []).filter((row) => row.id === id && (assigned === null || (referencedCompanyIds(row.action).length > 0 && referencedCompanyIds(row.action).every(id => assigned.includes(id))))).map(({ id, status, result }) => ({ id, status, result })));
  const previousQuotationId = completed.filter(row => row.status === "completed").map(row => row.result?.quotationId as string | undefined).filter(Boolean).at(-1);
  if (!currentQuotation && previousQuotationId && allowed.billing && allowed.customers && allowed.products && !currentConversation && !currentFlow && !input.pageContext?.flowDraft) {
    const saved = await optional("Previous quotation", async () => (await import("../data/quotations")).quotationDetail(previousQuotationId, viewer), null);
    if ((!companyId || saved?.catalog.company_id === companyId) && !(emailContext && !companyId)) currentQuotation = saved;
  }
  const previousInvoiceId = completed.map((row) => row.result?.invoiceId as string | undefined).filter(Boolean).at(-1);
  const invoiceId = pageInvoiceId || (!currentConversation && !currentFlow && !input.pageContext?.flowDraft ? previousInvoiceId : undefined);
  const candidateInvoice = allowed.billing && allowed.customers && invoiceId ? pageInvoiceId ? await getInvoice(invoiceId) : await optional("Previous invoice", () => getInvoice(invoiceId), null) : null;
  const invoice = !pageInvoiceId && ((companyId && candidateInvoice?.document.companyId !== companyId) || (emailContext && !companyId)) ? null : candidateInvoice;
  if (invoice?.document.companyId) await assertAiCustomerAccess(viewer, invoice.document.companyId, db);
  if (currentQuotation?.catalog.company_id) await assertAiCustomerAccess(viewer, currentQuotation.catalog.company_id, db);
  // An open company always takes precedence over the previous task's company.
  companyId ||= invoice?.document.companyId;
  const emailHistory = emailContext ?? (allowed.emails && allowed.customers && companyId ? await optional("Customer email history", () => loadAgentEmails(viewer, undefined, companyId), null) : null);
  const terms = [...new Set([
    ...input.messages.filter((message) => message.role === "user").slice(-3).flatMap((message) => message.content.match(/[\p{L}\p{N}_-]{2,80}/gu) ?? []),
    ...(emailHistory?.messages.slice(-6).flatMap((email) => `${email.subject} ${email.body}`.match(/[\p{L}\p{N}_-]{2,80}/gu) ?? []) ?? []),
    ...(invoice?.document.items.flatMap((item) => [item.productSku || ""]) ?? []),
  ].filter(Boolean))].slice(0, 150);
  const productsQuery = (allowed.products ? userProductRows(viewer.id) : Promise.resolve([])).then((rows) => {
    const matching = rows.filter((row) => row.active && (!terms.length || terms.some((term) => `${row.name} ${row.sku} ${row.color}`.toLowerCase().includes(term.toLowerCase()))));
    return { data: matching.slice(0, 100), count: matching.length, error: null };
  });
  const customerQuery = allowed.customers && terms.length ? (assigned === null
    ? db.from("companies").select("id,name,city,country,contacts(id,name,email)", { count: "exact" })
    : db.from("companies").select("id,name,city,country,contacts(id,name,email),pipeline!inner(owner_id)", { count: "exact" }))
    .or(terms.map((term) => `name.ilike.%${term}%`).join(",")).order("name").limit(25) : null;
  if (customerQuery && assigned !== null) customerQuery.eq("pipeline.owner_id", viewer.id);
  const flowTask = allowed.flows && allowed.emails && allowed.team && (Boolean(currentFlow || input.pageContext?.flowDraft) || /flow|automat|follow.?up/i.test(`${input.pathname} ${input.messages.at(-1)?.content ?? ""}`));
  const [bootstrap, customers, products, banks, paymentMethods, mailbox, matchingCustomers, flowMailboxes, flowMembers, flows, workflowAnalytics] = await Promise.all([
    allowed.billing && allowed.customers && allowed.settings ? optional("Invoice defaults", () => invoiceBootstrap({ companyId, ...(emailContext?.current && companyId ? { email: emailContext.current.contact, threadId: threadKeyForEmail(emailContext.current) } : {}) }), null) : null,
    allowed.customers ? optional("Customer choices", async () => {
      if (assigned === null) return invoiceCustomers();
      const { data, error, count } = await db.from("companies").select("id,name,city,country,contacts(id,name,email),pipeline!inner(owner_id)", { count: "exact" }).eq("pipeline.owner_id", viewer.id).order("name").range(0, 24);
      if (error) throw error;
      return { customers: data ?? [], count: count ?? 0 };
    }, null) : null,
    productsQuery,
    allowed.billing ? optional("Legacy banks", () => invoiceBankAccounts(), []) : [],
    allowed.billing ? optional("Payment methods", () => invoicePaymentMethods(), []) : [],
    allowed.emails ? optional("Default sender", () => getEffectiveMailbox(viewer.id), null) : null,
    customerQuery,
    flowTask ? db.from("workspace_mailboxes").select("id,email,display_name,type,is_default").eq("is_active", true).or(`type.eq.workspace,user_id.eq.${viewer.id}`).limit(100) : null,
    flowTask ? db.from("workspace_members").select("user_id,display_name").not("activated_at", "is", null).limit(200) : null,
    flowTask && assigned === null ? db.from("flows").select("id,name,status,trigger_type,trigger_config").eq("user_id", viewer.id).order("updated_at", { ascending: false }).limit(20) : null,
    workflowAnalyticsPromise,
  ]);
  if (products.error) contextWarnings.push("Catalog products unavailable. Look up required products before quoting or invoicing.");
  if (matchingCustomers?.error) contextWarnings.push("Matching customers unavailable. Look up the target before acting.");
  if (flowMailboxes?.error || flowMembers?.error || flows?.error) contextWarnings.push("Some workflow resources are unavailable. Look up required resources before acting.");
  // Avoid sending images, mailbox passwords or transport credentials to the model.
  const catalog = ((products.error ? [] : products.data ?? []) as InvoiceProductRow[]).map(invoiceProduct).map((product) => ({
    sku: product.sku, name: product.name, currency: product.currency, priceMinor: product.priceMinor,
    moq: product.moq, stockStatus: product.stockStatus, tiers: product.tiers,
    variants: product.variants.map((variant) => ({ id: variant.id, name: variant.name, sku: variant.sku, priceMinor: variant.priceMinor, stockStatus: variant.stockStatus })),
  }));
  return {
    currentCompanyId: allowed.customers ? companyId ?? null : null,
    currentCompany: allowed.customers && companyId ? await optional("Customer profile", () => loadAgentCompany(companyId, allowed.billing, viewer), null) : null,
    currentConversation,
    currentFlow,
    ...(input.pathname === "/workflow/analytics" ? { workflowAnalytics } : {}),
    flowEditor: allowed.flows && policy.features.pageContext && !restrictedAiContext(policy) && (input.pageContext?.flowDraft || input.pageContext?.flowUnsaved) ? { definition: input.pageContext.flowDraft ?? null, unsaved: input.pageContext.flowUnsaved ?? false, selectedStepId: input.pageContext.flowStepId ?? null, evidenceOnly: true } : null,
    currentEmail: emailContext?.current ? { ...presentAgentEmail(emailContext.current), mailboxId: emailContext.mailboxId ?? null } : null,
    emailHistory: emailHistory?.messages.map(presentAgentEmail) ?? [],
    emailCoverage: { included: emailHistory?.messages.length ?? 0, unavailableBodies: emailHistory?.messages.filter((email) => email.bodyLoaded === false).length ?? 0, scope: emailContext ? "selected conversation, up to 12 recent messages plus the selected email" : "up to 12 recent customer messages", maxCharactersPerMessage: 12000 },
    currentInvoice: invoice,
    currentQuotation,
    invoiceDefaults: bootstrap?.document ?? null,
    billing: bootstrap?.billing ?? null,
    customerChoices: [...new Map([...(customers?.customers ?? []), ...(matchingCustomers?.error ? [] : matchingCustomers?.data ?? [])].map((customer) => [customer.id, customer])).values()],
    customerCoverage: { firstPage: customers?.customers.length ?? 0, total: customers?.count ?? null, matching: matchingCustomers?.count ?? 0 },
    products: catalog,
    productCoverage: { included: catalog.length, matching: products.count },
    banks,
    paymentMethods,
    flowCapabilities: flowAgentCapabilities(),
    ...(flowTask ? { flowResources: { mailboxes: flowMailboxes?.data ?? [], members: flowMembers?.data ?? [], recentFlows: flows?.data ?? [] } } : {}),
    sender: mailboxHasSmtp(mailbox) ? mailbox?.email : null,
    EXECUTION_RESULTS: completed,
    contextWarnings,
    permissions: { role: viewer.role, canAct: viewer.role !== "viewer", canEditOwnProducts: true, canCreateOwnCatalogs: true },
  };
}
