import "server-only";
import { z } from "zod";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { invoiceBootstrap, invoiceCustomers, invoiceProductSelect } from "../data/invoice-connections";
import { invoiceBankAccounts } from "../data/invoice-banks";
import { getInvoice } from "../data/invoices";
import { getEffectiveMailbox, mailboxHasSmtp } from "../data/mailboxes";
import { invoiceProduct, type InvoiceProductRow } from "../invoice-links";
import type { WorkspaceAssistantInput } from "./workspace-assistant";

export async function loadAgentContext(input: WorkspaceAssistantInput, viewer: WorkspaceViewer) {
  const db = createSupabaseAdmin();
  const invoiceMatch = /^\/invoices\/([^/?]+)/.exec(input.pathname)?.[1];
  const companyMatch = /^\/companies\/([^/?]+)/.exec(input.pathname)?.[1];
  const pageInvoiceId = input.pageContext?.invoiceId || (z.uuid().safeParse(invoiceMatch).success ? invoiceMatch : undefined);
  let companyId = input.pageContext?.companyId || (z.uuid().safeParse(companyMatch).success ? companyMatch : undefined);
  const history = input.completedActionIds.length
    ? await db.from("workspace_agent_actions").select("id,status,result").eq("user_id", viewer.id).in("status", ["completed", "failed", "running"]).in("id", input.completedActionIds)
    : { data: [], error: null };
  if (history.error) throw new Error("Unable to read previous agent results.");
  const completed = input.completedActionIds.flatMap((id) => (history.data ?? []).filter((row) => row.id === id));
  const previousInvoiceId = completed.map((row) => row.result?.invoiceId as string | undefined).filter(Boolean).at(-1);
  const invoiceId = pageInvoiceId || previousInvoiceId;
  const candidateInvoice = invoiceId ? await getInvoice(invoiceId) : null;
  const invoice = !pageInvoiceId && companyId && candidateInvoice?.document.companyId !== companyId ? null : candidateInvoice;
  // An open company always takes precedence over the previous task's company.
  companyId ||= invoice?.document.companyId;
  const terms = [...new Set(input.messages.filter((message) => message.role === "user").slice(-3).flatMap((message) => message.content.match(/[\p{L}\p{N}_-]{2,80}/gu) ?? []))].slice(-35);
  let productsQuery = db.from("products").select(invoiceProductSelect, { count: "exact" }).eq("active", true).not("sku", "like", "SAMPLE-%");
  if (terms.length) productsQuery = productsQuery.or(terms.flatMap((term) => [`name.ilike.%${term}%`, `sku.ilike.%${term}%`]).join(","));
  const customerQuery = terms.length ? db.from("companies").select("id,name,city,country,contacts(id,name,email)", { count: "exact" }).or(terms.map((term) => `name.ilike.%${term}%`).join(",")).order("name").limit(25) : null;
  const [bootstrap, customers, products, banks, mailbox, matchingCustomers] = await Promise.all([
    invoiceBootstrap({ companyId }),
    invoiceCustomers(),
    productsQuery.order("name").limit(100),
    invoiceBankAccounts(),
    getEffectiveMailbox(viewer.id),
    customerQuery,
  ]);
  if (products.error) throw new Error("Unable to read current catalog products.");
  if (matchingCustomers?.error) throw new Error("Unable to read matching CRM customers.");
  // Avoid sending images, mailbox passwords or transport credentials to the model.
  const catalog = ((products.data ?? []) as InvoiceProductRow[]).map(invoiceProduct).map((product) => ({
    sku: product.sku, name: product.name, currency: product.currency, priceMinor: product.priceMinor,
    moq: product.moq, stockStatus: product.stockStatus, tiers: product.tiers,
    variants: product.variants.map((variant) => ({ id: variant.id, name: variant.name, sku: variant.sku, priceMinor: variant.priceMinor, stockStatus: variant.stockStatus })),
  }));
  return {
    currentCompanyId: companyId ?? null,
    currentInvoice: invoice,
    invoiceDefaults: bootstrap.document,
    billing: bootstrap.billing,
    customerChoices: [...new Map([...customers.customers, ...(matchingCustomers?.data ?? [])].map((customer) => [customer.id, customer])).values()],
    customerCoverage: { firstPage: customers.customers.length, total: customers.count, matching: matchingCustomers?.count ?? 0 },
    products: catalog,
    productCoverage: { included: catalog.length, matching: products.count },
    banks,
    sender: mailboxHasSmtp(mailbox) ? mailbox?.email : null,
    EXECUTION_RESULTS: completed,
    permissions: { role: viewer.role, canAct: viewer.role !== "viewer" },
  };
}
