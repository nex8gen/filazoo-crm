import "server-only";
import { z } from "zod";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { invoiceBootstrap, invoiceCustomers, invoiceProductSelect } from "../data/invoice-connections";
import { invoiceBankAccounts } from "../data/invoice-banks";
import { invoicePaymentMethods } from "../data/invoice-payment-methods";
import { getInvoice } from "../data/invoices";
import { getEffectiveMailbox, mailboxHasSmtp } from "../data/mailboxes";
import { invoiceProduct, type InvoiceProductRow } from "../invoice-links";
import type { WorkspaceAssistantInput } from "./workspace-assistant";
import { loadAgentCompany, loadAgentEmails, presentAgentEmail } from "./agent-records";
import { threadKeyForEmail } from "../email-threading";
import { flowAgentCapabilities } from "../flows";

export { searchAgentEmails } from "./agent-records";

export async function loadAgentContext(input: WorkspaceAssistantInput, viewer: WorkspaceViewer) {
  const db = createSupabaseAdmin();
  const invoiceMatch = /^\/invoices\/([^/?]+)/.exec(input.pathname)?.[1];
  const companyMatch = /^\/companies\/([^/?]+)/.exec(input.pathname)?.[1];
  const pageInvoiceId = input.pageContext?.invoiceId || (z.uuid().safeParse(invoiceMatch).success ? invoiceMatch : undefined);
  let companyId = input.pageContext?.companyId || (z.uuid().safeParse(companyMatch).success ? companyMatch : undefined);
  const emailContext = input.pageContext?.emailId ? await loadAgentEmails(viewer, input.pageContext.emailId) : null;
  if (emailContext) companyId = emailContext.companyId || undefined;
  const history = input.completedActionIds.length
    ? await db.from("workspace_agent_actions").select("id,status,result").eq("user_id", viewer.id).in("status", ["completed", "failed", "running"]).in("id", input.completedActionIds)
    : { data: [], error: null };
  if (history.error) throw new Error("Unable to read previous agent results.");
  const completed = input.completedActionIds.flatMap((id) => (history.data ?? []).filter((row) => row.id === id));
  const previousInvoiceId = completed.map((row) => row.result?.invoiceId as string | undefined).filter(Boolean).at(-1);
  const invoiceId = pageInvoiceId || previousInvoiceId;
  const candidateInvoice = invoiceId ? await getInvoice(invoiceId) : null;
  const invoice = !pageInvoiceId && ((companyId && candidateInvoice?.document.companyId !== companyId) || (emailContext && !companyId)) ? null : candidateInvoice;
  // An open company always takes precedence over the previous task's company.
  companyId ||= invoice?.document.companyId;
  const emailHistory = emailContext ?? (companyId ? await loadAgentEmails(viewer, undefined, companyId) : null);
  const terms = [...new Set([
    ...input.messages.filter((message) => message.role === "user").slice(-3).flatMap((message) => message.content.match(/[\p{L}\p{N}_-]{2,80}/gu) ?? []),
    ...(emailHistory?.messages.slice(-6).flatMap((email) => `${email.subject} ${email.body}`.match(/[\p{L}\p{N}_-]{2,80}/gu) ?? []) ?? []),
    ...(invoice?.document.items.flatMap((item) => [item.productSku || ""]) ?? []),
  ].filter(Boolean))].slice(0, 150);
  let productsQuery = db.from("products").select(invoiceProductSelect, { count: "exact" }).eq("active", true).not("sku", "like", "SAMPLE-%");
  if (terms.length) productsQuery = productsQuery.or(terms.flatMap((term) => [`name.ilike.%${term}%`, `sku.ilike.%${term}%`]).join(","));
  const customerQuery = terms.length ? db.from("companies").select("id,name,city,country,contacts(id,name,email)", { count: "exact" }).or(terms.map((term) => `name.ilike.%${term}%`).join(",")).order("name").limit(25) : null;
  const flowTask = /flow|automat|follow.?up/i.test(`${input.pathname} ${input.messages.at(-1)?.content ?? ""}`);
  const [bootstrap, customers, products, banks, paymentMethods, mailbox, matchingCustomers, flowMailboxes, flowMembers, flows] = await Promise.all([
    invoiceBootstrap({ companyId, ...(emailContext?.current && companyId ? { email: emailContext.current.contact, threadId: threadKeyForEmail(emailContext.current) } : {}) }),
    invoiceCustomers(),
    productsQuery.order("name").limit(100),
    invoiceBankAccounts(),
    invoicePaymentMethods(),
    getEffectiveMailbox(viewer.id),
    customerQuery,
    flowTask ? db.from("workspace_mailboxes").select("id,email,display_name,type,is_default").eq("is_active", true).or(`type.eq.workspace,user_id.eq.${viewer.id}`).limit(100) : null,
    flowTask ? db.from("workspace_members").select("user_id,display_name").not("activated_at", "is", null).limit(200) : null,
    flowTask ? db.from("flows").select("id,name,status,trigger_type,trigger_config").eq("user_id", viewer.id).order("updated_at", { ascending: false }).limit(20) : null,
  ]);
  if (products.error) throw new Error("Unable to read current catalog products.");
  if (matchingCustomers?.error) throw new Error("Unable to read matching CRM customers.");
  if (flowMailboxes?.error || flowMembers?.error || flows?.error) throw new Error("Unable to read current flow resources.");
  // Avoid sending images, mailbox passwords or transport credentials to the model.
  const catalog = ((products.data ?? []) as InvoiceProductRow[]).map(invoiceProduct).map((product) => ({
    sku: product.sku, name: product.name, currency: product.currency, priceMinor: product.priceMinor,
    moq: product.moq, stockStatus: product.stockStatus, tiers: product.tiers,
    variants: product.variants.map((variant) => ({ id: variant.id, name: variant.name, sku: variant.sku, priceMinor: variant.priceMinor, stockStatus: variant.stockStatus })),
  }));
  return {
    currentCompanyId: companyId ?? null,
    currentCompany: companyId ? await loadAgentCompany(companyId) : null,
    currentEmail: emailContext?.current ? presentAgentEmail(emailContext.current) : null,
    emailHistory: emailHistory?.messages.map(presentAgentEmail) ?? [],
    emailCoverage: { included: emailHistory?.messages.length ?? 0, scope: emailContext ? "selected conversation, up to 12 recent messages plus the selected email" : "up to 12 recent customer messages", maxCharactersPerMessage: 12000 },
    currentInvoice: invoice,
    invoiceDefaults: bootstrap.document,
    billing: bootstrap.billing,
    customerChoices: [...new Map([...customers.customers, ...(matchingCustomers?.data ?? [])].map((customer) => [customer.id, customer])).values()],
    customerCoverage: { firstPage: customers.customers.length, total: customers.count, matching: matchingCustomers?.count ?? 0 },
    products: catalog,
    productCoverage: { included: catalog.length, matching: products.count },
    banks,
    paymentMethods,
    flowCapabilities: flowAgentCapabilities(),
    ...(flowTask ? { flowResources: { mailboxes: flowMailboxes?.data ?? [], members: flowMembers?.data ?? [], recentFlows: flows?.data ?? [] } } : {}),
    sender: mailboxHasSmtp(mailbox) ? mailbox?.email : null,
    EXECUTION_RESULTS: completed,
    permissions: { role: viewer.role, canAct: viewer.role !== "viewer" },
  };
}
