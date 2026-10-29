import "server-only";
import { z } from "zod";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import * as crm from "@/app/crm-actions";
import * as settings from "@/app/settings/actions";
import { saveUserPreferences } from "@/app/settings/preference-actions";
import { createSegment, updateSegment } from "@/app/segment-actions";
import { syncInventory } from "@/app/inventory-actions";
import { getInventoryState } from "../data/inventory";
import { segmentInputSchema } from "../segments";
import { savePurchaseOrder, createOrderInvoice, getPurchaseOrderProfile } from "@/app/purchase-order-actions";
import { POST as saveEmailState } from "@/app/api/email/state/route";
import { sendMetaTextMessage } from "../meta-messenger";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { createFlow, updateFlow, deleteFlow, listWorkspaceFlows } from "../data/flows";
import { getInvoice, mutateInvoice, createInvoice } from "../data/invoices";
import { invoiceBootstrap, validateInvoiceConnections } from "../data/invoice-connections";
import { invoiceDocumentSchema, invoiceTotals } from "../invoices";
import { invoicePaymentMethodsSchema } from "../invoice-payment-methods";
import { canMutateInvoice, canEditInvoice } from "../invoice-permissions";
import { patchInvoiceSettings, invoicePaymentMethods } from "../data/invoice-payment-methods";
import { readInvoiceDefaults } from "../invoice-defaults";
import { readUserPreferences } from "../user-preferences";
import { flowInputSchema } from "../flows";
import { purchaseOrderSchema } from "../purchase-orders";
import { variantsFromTags } from "../product-utils";
import { listWorkspaceMembers } from "../data/members";
import { updateFlowActivity } from "../data/flow-activity";
import { loadAgentCompany, loadAgentEmails } from "./agent-records";
import { agentProductSchema, crmOperationSchema, crmOperationLabels, type CrmOperation, type PreparedCrmAction } from "./crm-tools";
import { isProductivityOperation } from "./crm-productivity";
import { productivityTarget, executeProductivityOperation } from "./crm-productivity-execution";

const adminOperations = new Set(["assign_owner", "delete_company", "invite_member", "update_member", "delete_member"]);
export function authorizeCrmOperation(viewer: WorkspaceViewer, operation: CrmOperation) {
  if (viewer.role === "viewer") throw new Error("Your workspace role is read-only.");
  if (adminOperations.has(operation.op) && viewer.role !== "admin") throw new Error("This action requires a workspace administrator.");
  if (["invoice_lifecycle", "invoice_defaults", "payment_methods", "sync_inventory"].includes(operation.op) && !["admin", "operator"].includes(viewer.role)) throw new Error("This action requires an admin or operator.");
}

function form(values: Record<string, unknown>) {
  const result = new FormData();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null) result.set(key, String(value));
  });
  return result;
}
function checked(result: { error?: string; success?: string } | undefined, fallback: string) {
  if (!result) throw new Error("The CRM did not confirm this action. Check the record before retrying.");
  if (result.error) throw new Error(result.error);
  return result.success || fallback;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function one(table: string, fields: string, key: string, value: string) {
  const result = await createSupabaseAdmin().from(table).select(fields).eq(key, value).maybeSingle();
  if (result.error) throw new Error("Unable to read the selected CRM record.");
  return result.data as Record<string, unknown> | null;
}

/** Reload only the relevant record, with ownership checked before preparing and executing. */
async function target(operation: CrmOperation, viewer: WorkspaceViewer): Promise<{ name: string; value: unknown; preview: Record<string, unknown> }> {
  if (isProductivityOperation(operation)) return productivityTarget(operation, viewer);
  if (operation.op === "create_segment" || operation.op === "update_segment") {
    const saved = operation.op === "update_segment" ? await one("company_segments", "id,name,description,rules", "id", operation.segmentId) : null;
    if (operation.op === "update_segment" && !saved) throw new Error("This saved segment is no longer available.");
    const segment = segmentInputSchema.strict().parse(operation.op === "create_segment" ? operation.segment : { name: saved!.name, description: saved!.description, rules: saved!.rules, ...operation.changes });
    return { name: segment.name, value: saved, preview: { segment } };
  }
  if (operation.op === "sync_inventory") {
    const { status } = await getInventoryState();
    if (!status.configured || status.configurationError) throw new Error("Configure an active ERP connection in Settings before syncing inventory.");
    const scope = { configured: status.configured, warehouseIds: status.warehouseIds };
    return { name: "ERP inventory", value: scope, preview: { ...scope, effect: "Refresh the saved stock snapshot from the connected ERP. Product prices are preserved." } };
  }
  const db = createSupabaseAdmin();
  if (operation.op === "custom_invoice") {
    const existing = operation.invoiceId ? await getInvoice(operation.invoiceId) : null;
    if (operation.invoiceId && (!existing || !canEditInvoice(viewer, existing))) throw new Error("Choose a draft invoice you can edit.");
    if (existing && (existing.document.companyId !== operation.companyId || existing.document.purchaseOrderId)) throw new Error("Keep the invoice's original customer and linked purchase-order products.");
    const base = existing?.document ?? (await invoiceBootstrap({ companyId: operation.companyId })).document;
    const currency = operation.details?.currency ?? base.currency;
    const methods = existing ? undefined : await invoicePaymentMethods();
    if (methods?.length && !methods.some((method) => !method.currency || method.currency === currency)) throw new Error("No current payment method supports this invoice currency. Configure one before creating the invoice.");
    const document = invoiceDocumentSchema.parse({ ...base, ...operation.details, items: operation.items.map((item) => ({ ...item, pricingMode: "manual" })), ...(methods ? { paymentMethods: methods.filter((method) => !method.currency || method.currency === currency), bankAccountId: undefined, bankAccount: undefined, paymentInstructions: "" } : {}) });
    await validateInvoiceConnections(document);
    return { name: document.customerName, value: { existing, base, methods }, preview: { document, revision: existing?.revision ?? null, totalMinor: invoiceTotals(document).total, currency: document.currency } };
  }
  if (operation.op === "complete_activity") {
    const row = operation.kind === "task" ? await one("crm_tasks", "id,title,status,assigned_to,updated_at", "id", operation.id) : await one("internal_notifications", "id,message,user_id,read_at", "id", operation.id);
    if (!row || (operation.kind === "task" ? row.assigned_to : row.user_id) !== viewer.id) throw new Error("This item is unavailable or belongs to another teammate.");
    return { name: String(row.title || row.message).slice(0, 300), value: row, preview: { action: operation.kind === "task" ? "Mark task complete" : "Mark notification read" } };
  }
  if (operation.op === "create_product" || operation.op === "update_product") {
    const sku = operation.op === "create_product" ? operation.product.sku : operation.sku;
    const row = await one("products", "sku,name,material,color,diameter,weight,currency,price,moq,tags,stock_status,lead_time,image_url,active,sheet_updated_at", "sku", sku);
    if (operation.op === "create_product" && row) throw new Error("This product SKU already exists. Update it instead.");
    if (operation.op === "update_product" && !row) throw new Error("This product no longer exists.");
    const current = row ? productFromRow(row) : {};
    const product = agentProductSchema.parse(operation.op === "create_product" ? operation.product : { ...current, ...operation.changes });
    return { name: product.name, value: row, preview: { product } };
  }
  if ("flowId" in operation) {
    const flow = (await listWorkspaceFlows()).find((flow) => flow.id === operation.flowId);
    const owner = await one("flows", "user_id", "id", operation.flowId);
    if (!flow || !owner || (operation.op !== "duplicate_flow" && viewer.role !== "admin" && owner.user_id !== viewer.id)) throw new Error("Flow not found or you cannot manage it.");
    const definition = flowInputSchema.parse(flow);
    const next = operation.op === "update_flow" ? { ...definition, ...operation.changes, ...(operation.changes.triggerConfig && (!operation.changes.triggerType || operation.changes.triggerType === definition.triggerType) ? { triggerConfig: { ...definition.triggerConfig, ...operation.changes.triggerConfig } } : {}) }
      : operation.op === "flow_status" ? { ...definition, status: operation.status }
      : operation.op === "duplicate_flow" ? { ...definition, name: operation.name, status: "draft" } : definition;
    return { name: flow.name, value: { definition, updatedAt: flow.updatedAt, owner: owner.user_id }, preview: { flow: flowInputSchema.parse(next) } };
  }
  if (operation.op === "invoice_lifecycle") {
    const invoice = await getInvoice(operation.invoiceId);
    if (!invoice || !canMutateInvoice(viewer, invoice, operation.action)) throw new Error("Invoice not found or you cannot perform this action.");
    if (operation.action === "issue" && invoice.status !== "draft") throw new Error("Only a draft invoice can be issued.");
    if (operation.action === "payment" && invoice.status !== "issued") throw new Error("Payments require an issued invoice.");
    if (operation.action === "delete" && invoice.status !== "draft") throw new Error("Only a draft invoice can be deleted.");
    return { name: `INV-${String(invoice.number).padStart(6, "0")}`, value: invoice, preview: { action: operation.action, customer: invoice.document.customerName, currency: invoice.document.currency, totalMinor: invoice.total_minor, paidMinor: invoice.paid_minor, ...(operation.payment ? { payment: operation.payment } : {}) } };
  }
  if (operation.op === "set_email_state") {
    const { current } = await loadAgentEmails(viewer, operation.emailId);
    if (!current) throw new Error("Email not found.");
    const state = { category: current.category ?? null, starred: current.starred ?? false, read: current.read ?? false, folder: current.folder ?? "inbox", followUpAt: current.followUpAt ?? null };
    return { name: current.subject || current.contact, value: state, preview: { state: { ...state, ...operation.changes }, messageKey: current.id, contactEmail: current.contact, threadId: current.threadId ?? null } };
  }
  if (operation.op === "send_message" || operation.op === "draft_message") {
    const message = await one("meta_messages", "id,sender_id,recipient_id,direction,source,customer_name,thread_id,page_id", "id", operation.messageId);
    if (!message || message.direction !== "inbound") throw new Error("Choose an actual inbound customer message to reply to.");
    const channel = message.source === "twilio_whatsapp" ? "whatsapp" : message.source === "instagram_messaging" ? "instagram" : message.source === "facebook_messenger" ? "facebook" : null;
    if (!channel) throw new Error("This message channel is unsupported.");
    return { name: String(message.customer_name || message.sender_id), value: message, preview: { to: message.sender_id, channel, text: operation.text, delivery: operation.op === "draft_message" ? "draft" : "send", conversationId: `${channel}:${message.page_id}:${message.thread_id}` } };
  }
  if (operation.op === "manage_mailbox") {
    const row = await one("workspace_mailboxes", "id,user_id,email,display_name,type,is_active,is_default", "id", operation.mailboxId);
    if (!row || (viewer.role !== "admin" && (row.type !== "personal" || row.user_id !== viewer.id))) throw new Error("Mailbox not found or you cannot manage it.");
    return { name: String(row.email), value: row, preview: { operation: operation.operation, email: row.email } };
  }
  if (operation.op === "update_member" || operation.op === "delete_member") {
    const row = (await listWorkspaceMembers()).find((member) => member.id === operation.userId);
    if (!row) throw new Error("Team member not found.");
    return { name: String(row.displayName || row.email), value: row, preview: { ...operation } };
  }
  if (operation.op === "invite_member") return { name: operation.email, value: null, preview: { ...operation } };
  if (operation.op === "update_profile") return { name: viewer.displayName || viewer.email || "My profile", value: viewer.displayName, preview: { displayName: operation.displayName } };
  if (operation.op === "save_preferences") {
    const preferences = readUserPreferences(viewer.preferences);
    return { name: "My preferences", value: preferences, preview: { preferences: { ...preferences, ...operation.changes } } };
  }
  if (operation.op === "invoice_defaults" || operation.op === "payment_methods") {
    const row = await db.from("invoice_settings").select("settings").eq("singleton", true).maybeSingle();
    if (row.error) throw new Error("Unable to read invoice settings.");
    const saved = readInvoiceDefaults(row.data?.settings ?? {});
    const changes = operation.op === "payment_methods" ? { paymentMethods: invoicePaymentMethodsSchema.parse(operation.paymentMethods) }
      : { ...saved.seller, ...operation.seller, defaults: { ...saved.defaults, ...operation.defaults } };
    return { name: "Workspace invoice settings", value: row.data?.settings ?? {}, preview: { changes } };
  }
  if ("companyId" in operation) {
    const company = await loadAgentCompany(operation.companyId);
    let value: unknown = company;
    let preview: Record<string, unknown> = { ...operation };
    if (operation.op === "assign_owner" && operation.ownerId) {
      const owner = await one("workspace_members", "user_id,display_name,activated_at,role", "user_id", operation.ownerId);
      if (!owner?.activated_at) throw new Error("Choose an active workspace member.");
      value = { company, owner };
      preview = { owner: owner.display_name, ownerId: operation.ownerId };
    }
    if (operation.op === "save_order" || operation.op === "invoice_order") {
      const row = operation.orderId ? await one("purchase_orders", "id,company_id,document,version", "id", operation.orderId) : null;
      if (operation.orderId && (!row || row.company_id !== operation.companyId)) throw new Error("This order does not belong to the selected company.");
      value = { company, order: row };
      if (operation.op === "save_order") {
        const profile = row ? null : await getPurchaseOrderProfile(operation.companyId);
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        const base = row?.document ?? { customer: profile?.customer, orderDate: today, deliveryDate: "", currency: profile?.commerce.currency || "USD", status: "draft", shippingAddress: profile?.commerce.shippingAddress || "", shippingRecipient: profile?.commerce.shippingRecipient || "", shippingPhone: profile?.commerce.shippingPhone || "", notes: "" };
        const document = purchaseOrderSchema.parse({ ...base as object, ...operation.changes });
        value = { company, order: row, profile };
        preview = { document, version: row?.version ?? 0 };
      }
    }
    if (operation.op === "create_catalog") {
      let products = db.from("products").select("sku,name,currency,price,tags,active").eq("active", true).order("sku");
      if (operation.productSkus.length) products = products.in("sku", operation.productSkus);
      const rows = await products.limit(101);
      if (rows.error || (operation.productSkus.length && rows.data?.length !== operation.productSkus.length)) throw new Error("One or more selected catalog products are unavailable.");
      if (!operation.productSkus.length && (rows.data?.length ?? 0) > 100) throw new Error("Choose up to 100 specific catalog products.");
      value = { company, products: rows.data };
      preview = { currency: operation.currency, products: (rows.data ?? []).map((row) => {
        const product = productFromRow(row);
        return { sku: product.sku, name: product.name, currency: product.currency,
          tiers: product.tiers.map((tier) => ({ minimum: tier.minimum, unitPriceMinor: Math.round(tier.price * 100) })),
          variants: product.variants.map(({ name, sku, price }) => ({ name, sku, price })) };
      }) };
    }
    return { name: company.fields.name, value, preview };
  }
  throw new Error("Unsupported CRM action.");
}

export function productFromRow(row: Record<string, unknown>) {
  const tags = (row.tags ?? []) as string[];
  const tiers = tags.flatMap((tag) => {
    const match = /^price-tier:(\d+):(\d+(?:\.\d+)?)$/.exec(tag);
    return match ? [{ minimum: Number(match[1]), price: Number(match[2]) }] : [];
  }).sort((a, b) => a.minimum - b.minimum);
  return { sku: row.sku, name: row.name, material: row.material || "", diameter: row.diameter || "", weight: row.weight || "", currency: row.currency,
    tiers: tiers.length ? tiers : row.price === null ? [] : [{ minimum: row.moq ?? 1, price: Number(row.price) }],
    variants: variantsFromTags(tags, String(row.color || "").split(",").map((color) => color.trim()).filter(Boolean), String(row.sku), row.price === null ? "" : String(row.price), String(row.stock_status || "")),
    stockStatus: row.stock_status || "", leadTime: row.lead_time || "", imageUrl: row.image_url || "", active: row.active };
}
export function productForm(product: z.infer<typeof agentProductSchema>, originalSku?: string) {
  const tiers = [...product.tiers].sort((a, b) => a.minimum - b.minimum);
  return form({ ...product, originalSku, colors: product.variants.map((item) => item.name).join(", "), variants: JSON.stringify(product.variants),
    minimum1: tiers[0].minimum, price1: tiers[0].price, minimum2: tiers[1]?.minimum ?? "", price2: tiers[1]?.price ?? "", minimum3: tiers[2]?.minimum ?? "", price3: tiers[2]?.price ?? "" });
}

export async function prepareCrmAction(input: CrmOperation, viewer: WorkspaceViewer): Promise<PreparedCrmAction> {
  let operation = crmOperationSchema.parse(input);
  authorizeCrmOperation(viewer, operation);
  if (operation.op === "payment_methods") operation = { ...operation, paymentMethods: operation.paymentMethods.map((method) => ({ ...method, id: method.id ?? crypto.randomUUID() })) };
  const record = await target(operation, viewer);
  return { type: "crm_action", operation, target: record.name, fingerprint: hash(record.value), preview: record.preview };
}

export async function executeCrmAction(action: PreparedCrmAction, viewer: WorkspaceViewer, actionId: string, request: Request) {
  const operation = crmOperationSchema.parse(action.operation);
  authorizeCrmOperation(viewer, operation);
  const current = await target(operation, viewer);
  if (hash(current.value) !== action.fingerprint) throw new Error("This record changed after the proposal. Ask the agent to prepare it again.");
  if (isProductivityOperation(operation)) return executeProductivityOperation(operation, viewer, actionId, current.preview, request);
  let result: { error?: string; success?: string } | undefined;
  let href = "/";
  if (operation.op === "create_segment" || operation.op === "update_segment") {
    const segment = segmentInputSchema.parse(current.preview.segment);
    const data = form({ ...segment, rules: JSON.stringify(segment.rules), ...(operation.op === "update_segment" ? { segmentId: operation.segmentId } : {}) });
    result = operation.op === "create_segment" ? await createSegment({}, data) : await updateSegment({}, data);
    return { success: checked(result, "Saved segment updated."), href: "/segments" };
  }
  if (operation.op === "sync_inventory") {
    const saved = await syncInventory();
    if (!saved.ok) throw new Error(saved.error);
    return { success: saved.skipped ? "An inventory sync is already running. No new sync was started." : `Inventory synced: ${saved.count} stock records refreshed.`, href: "/catalogs" };
  }
  const extra: Record<string, unknown> = {};
  switch (operation.op) {
    case "schedule_followup": result = await crm.scheduleCompanyFollowup(operation.companyId, operation.dueAt); href = `/companies/${operation.companyId}`; break;
    case "assign_owner": result = await crm.assignPipelineOwner(operation.companyId, operation.ownerId); href = `/companies/${operation.companyId}`; break;
    case "delete_company": result = await crm.bulkUpdateCompanies([operation.companyId], "delete"); href = "/companies"; break;
    case "create_catalog": {
      const data = form({ companyId: operation.companyId, currency: operation.currency });
      operation.productSkus.forEach((sku) => data.append("productSkus", sku));
      result = await crm.createCatalog(undefined, data); href = "/catalogs/companies"; break;
    }
    case "create_product": result = await crm.createProduct(undefined, productForm(agentProductSchema.parse(current.preview.product))); href = "/catalogs"; break;
    case "update_product": result = await crm.updateProduct(undefined, productForm(agentProductSchema.parse(current.preview.product), operation.sku)); href = "/catalogs"; break;
    case "save_order": {
      const saved = await savePurchaseOrder(operation.companyId, operation.orderId ?? null, Number(current.preview.version), current.preview.document);
      result = saved;
      if (saved.orderId) extra.orderId = saved.orderId;
      extra.companyId = operation.companyId;
      href = `/companies/${operation.companyId}`; break;
    }
    case "invoice_order": {
      const saved = await createOrderInvoice(operation.companyId, operation.orderId);
      if (saved.error || !saved.invoiceId) throw new Error(saved.error || "The CRM did not confirm an invoice.");
      extra.invoiceId = saved.invoiceId; href = `/invoices/${saved.invoiceId}`; result = { success: "Draft invoice created from the order's remaining quantities." }; break;
    }
    case "custom_invoice": {
      const document = invoiceDocumentSchema.parse(current.preview.document);
      const invoice = operation.invoiceId ? await mutateInvoice(operation.invoiceId, viewer.id, { action: "save", revision: current.preview.revision, document, totalMinor: invoiceTotals(document).total }) : await createInvoice(document, viewer.id, actionId);
      if (!invoice?.id) throw new Error("The CRM did not confirm the saved invoice. Check Invoices before retrying.");
      extra.invoiceId = invoice.id; href = `/invoices/${invoice.id}`; result = { success: "Custom-price draft invoice saved." }; revalidatePath("/invoices"); revalidatePath(href); revalidatePath(`/companies/${operation.companyId}`); break;
    }
    case "invoice_lifecycle": {
      const invoice = await getInvoice(operation.invoiceId);
      if (!invoice || hash(invoice) !== action.fingerprint) throw new Error("This invoice changed after approval. Prepare a new proposal.");
      await mutateInvoice(operation.invoiceId, viewer.id, operation.action === "payment" ? { action: "payment", payment: { ...operation.payment!, id: actionId } } : { action: operation.action, revision: invoice.revision });
      result = { success: operation.action === "payment" ? "Received payment recorded." : `Invoice ${operation.action === "issue" ? "issued" : operation.action === "void" ? "voided" : "deleted"}.` };
      href = operation.action === "delete" ? "/invoices" : `/invoices/${operation.invoiceId}`; extra.invoiceId = operation.invoiceId;
      revalidatePath("/invoices"); revalidatePath(`/invoices/${operation.invoiceId}`); if (invoice.document.companyId) revalidatePath(`/companies/${invoice.document.companyId}`); break;
    }
    case "update_flow": case "flow_status": case "duplicate_flow": {
      const input = flowInputSchema.parse(current.preview.flow);
      const flow = operation.op === "duplicate_flow" ? await createFlow(viewer.id, input) : await updateFlow(viewer.id, operation.flowId, input);
      extra.flowId = flow.id; href = `/lead-channel/ai-agent?flow=${flow.id}`; result = { success: `${flow.name} saved as ${flow.status}.` }; revalidatePath("/lead-channel/ai-agent"); break;
    }
    case "delete_flow": await deleteFlow(viewer.id, operation.flowId); result = { success: "Automation flow deleted." }; href = "/lead-channel/ai-agent"; revalidatePath(href); break;
    case "set_email_state": {
      const response = await saveEmailState(new Request(new URL("/api/email/state", request.url), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...current.preview.state as object, messageKey: current.preview.messageKey, contactEmail: current.preview.contactEmail, threadId: current.preview.threadId }) }));
      const saved = await response.json(); if (!response.ok || !saved.ok) throw new Error(saved.error || "Email state could not be saved.");
      result = { success: "Email organization updated." }; href = "/emails"; break;
    }
    case "draft_message": {
      return { success: "Message draft prepared in Messenger.", href: "/messenger", draftMessage: { conversationId: String(current.preview.conversationId), text: operation.text } };
    }
    case "send_message": {
      const sent = await sendMetaTextMessage({ to: String(current.preview.to), text: operation.text, channel: current.preview.channel as "facebook" | "instagram" | "whatsapp" });
      if (!sent.ok) throw new Error(sent.error || "Message delivery was not confirmed. Check the conversation before retrying.");
      result = { success: `Message sent to ${current.name}.${sent.saved === false ? " Delivery was accepted, but the CRM history could not be saved. Check the channel before retrying." : ""}` }; href = "/messenger"; revalidatePath(href); break;
    }
    case "complete_activity": await updateFlowActivity(operation.kind, operation.id); result = { success: operation.kind === "task" ? "Task marked complete." : "Notification marked read." }; href = "/tasks"; revalidatePath(href); break;
    case "update_profile": result = await settings.updateProfile(undefined, form({ displayName: operation.displayName })); href = "/settings/profile"; break;
    case "invite_member": result = await settings.inviteMember(undefined, form(operation)); href = "/settings/team"; break;
    case "update_member": result = await settings.updateMember(undefined, form({ ...operation, autoAssignLeads: operation.autoAssignLeads ? "on" : undefined })); href = "/settings/team"; break;
    case "delete_member": result = await settings.deleteMember(undefined, form({ userId: operation.userId })); href = "/settings/team"; break;
    case "manage_mailbox": result = await settings.manageMailbox(undefined, form(operation)); href = "/settings/mailboxes"; break;
    case "save_preferences": {
      const saved = await saveUserPreferences(current.preview.preferences); if (saved.error) throw new Error(saved.error);
      result = { success: "Your preferences were saved." }; href = "/settings"; break;
    }
    case "invoice_defaults": case "payment_methods": await patchInvoiceSettings(current.preview.changes as Record<string, unknown>, viewer.id); result = { success: "Invoice settings saved." }; href = operation.op === "payment_methods" ? "/settings/payments" : "/settings/invoices"; revalidatePath("/settings", "layout"); break;
  }
  return { success: checked(result, `${crmOperationLabels[operation.op]} completed.`), href, ...extra };
}
